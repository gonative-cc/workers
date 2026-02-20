import { SUI_GRAPHQL_URLS } from "@gonative-cc/lib/nsui";
import { SuiGraphQLClient } from "./graphql-client";
import type { NetworkConfig } from "./models";
import { Processor } from "./processor";
import { D1Storage } from "./storage";
import { logError, logger } from "@gonative-cc/lib/logger";
import { getSecret } from "@gonative-cc/lib/secrets";
import { RedeemService } from "./redeem-service";
import { createSuiClients, type SuiClient } from "./redeem-sui-client";
import type { Service } from "@cloudflare/workers-types";
import type { WorkerEntrypoint } from "cloudflare:workers";
import type { BtcIndexerRpc } from "@gonative-cc/btcindexer/rpc-interface";
import HttpRouter from "./redeem-router";
import type { SuiNet } from "@gonative-cc/lib/nsui";
import type { PipelinePromise } from "stream";

const router = new HttpRouter();

// Export RPC entrypoints for service bindings
export { RPC } from "./rpc";
export { RPCMock } from "./rpc-mocks";

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return router.fetch(request, env, ctx);
	},
	scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
		return startCronJobs(env);
	},
} satisfies ExportedHandler<Env>;

async function startCronJobs(env: Env): Promise<void> {
	const storage = new D1Storage(env.DB);
	const activeNetworks = await storage.getActiveNetworks();
	const mnemonic = await getSecret(env.NBTC_MINTING_SIGNER_MNEMONIC);
	const suiClients = await createSuiClients(activeNetworks, mnemonic);
	const lockIndexer = "cron-sui-indexer";
	const lockRedeemSolver = "cron-sui-redeem-solver";
	const minute = 60_000;

	try {
		const lockTokens = await storage.acquireLocks([lockIndexer, lockRedeemSolver], 5 * minute);
		const indexerLockToken = lockTokens[0];
		const redeemSolverLockToken = lockTokens[1];

		const jobs: Promise<void>[] = [];
		const jobNames: string[] = [];

		if (indexerLockToken !== null) {
			jobs.push(runSuiIndexer(storage, activeNetworks, suiClients));
			jobNames.push("SuiIndexer");
		} else {
			logger.warn({
				msg: "SuiIndexer lock is busy, skipping",
			});
		}

		if (redeemSolverLockToken !== null) {
			jobs.push(runRedeemSolver(storage, env, suiClients, activeNetworks));
			jobNames.push("RedeemSolver");
		} else {
			logger.warn({
				msg: "RedeemSolver lock is busy, skipping",
			});
		}

		if (jobs.length === 0) return;

		const results = await Promise.allSettled(jobs);
		reportErrors(results, "scheduled", "Scheduled task error", jobNames);
	} finally {
		await storage.releaseLocks([lockIndexer, lockRedeemSolver]);
	}
}

async function runSuiIndexer(
	storage: D1Storage,
	activeNetworks: SuiNet[],
	suiClients: Map<SuiNet, SuiClient>,
) {
	if (activeNetworks.length === 0) {
		logger.info({ msg: "No active packages/networks found in database." });
		return;
	}

	const networksToProcess: NetworkConfig[] = [];
	for (const netName of activeNetworks) {
		const url = SUI_GRAPHQL_URLS[netName];
		if (url) {
			networksToProcess.push({ name: netName, url });
		} else {
			logger.warn({
				msg: "Skipping network: No GraphQL URL configured",
				network: netName,
			});
		}
	}

	logger.debug({
		msg: "Starting Indexer Loop",
		networks: networksToProcess.map((n) => n.name),
	});

	const networkJobs = networksToProcess.map((netCfg) =>
		poolAndProcessEvents(netCfg, storage, suiClients),
	);
	const results = await Promise.allSettled(networkJobs);
	reportErrors(
		results,
		"runSuiIndexer",
		"Failed to process network",
		networksToProcess.map((n) => n.name),
		"network",
	);
}

async function poolAndProcessEvents(
	netCfg: NetworkConfig,
	storage: D1Storage,
	suiClients: Map<SuiNet, SuiClient>,
) {
	const suiClient = suiClients.get(netCfg.name);
	if (!suiClient) {
		logger.warn({ msg: "No SuiClient for network, skipping", network: netCfg.name });
		return;
	}
	const client = new SuiGraphQLClient(netCfg.url);
	const p = new Processor(netCfg, storage, client, suiClient);

	const nbtcPkgs = await storage.getActiveNbtcPkgs(netCfg.name);
	if (nbtcPkgs.length > 0) {
		logger.info({
			msg: `Processing nBTC events`,
			network: netCfg.name,
			packageCount: nbtcPkgs.length,
		});
		await p.pollAllNbtcEvents(nbtcPkgs);
	}

	const ikaCursors = await storage.getIkaCoordinatorPkgsWithCursors(netCfg.name);
	const ikaPkgIds = Object.keys(ikaCursors);
	if (ikaPkgIds.length > 0) {
		logger.info({
			msg: `Processing IKA coordinator events`,
			network: netCfg.name,
			packageCount: ikaPkgIds.length,
		});
		await p.pollIkaEvents(ikaCursors);
	}
}

async function runRedeemSolver(
	storage: D1Storage,
	env: Env,
	suiClients: Map<SuiNet, SuiClient>,
	activeNetworks: SuiNet[],
) {
	logger.info({ msg: "Running scheduled redeem solver task..." });
	const service = new RedeemService(
		storage,
		suiClients,
		env.BtcIndexer as unknown as Service<BtcIndexerRpc & WorkerEntrypoint>,
		env.UTXO_LOCK_TIME,
		env.REDEEM_DURATION_MS,
	);

	const results: PromiseSettledResult<void>[] = [];

	results.push(await tryAsync(service.refillPresignPool(activeNetworks)));
	results.push(await tryAsync(service.processPendingRedeems()));

	// Solve and Sign
	results.push(
		await tryAsync(
			(async () => {
				await service.solveReadyRedeems();
				await service.processSigningRedeems();
			})(),
		),
	);

	// 4. Broadcast
	results.push(await tryAsync(service.broadcastReadyRedeems()));

	// Check for any rejected promises and log errors
	reportErrors(results, "runRedeemSolver", "Processing redeems error", [
		"refillPresignPool",
		"processPendingRedeems",
		"solveReadyRedeems/processSigningRedeems",
		"broadcastReadyRedeems",
	]);
}

async function tryAsync<T>(p: Promise<T>): Promise<PromiseSettledResult<T>> {
	try {
		const value = await p;
		return { status: "fulfilled", value };
	} catch (reason) {
		return { status: "rejected", reason };
	}
}

/**
 * Helper function to report errors from `Promise.allSettled` results.
 */
function reportErrors(
	results: PromiseSettledResult<unknown>[],
	method: string,
	msg: string,
	names: (string | undefined)[],
	nameKey = "task",
) {
	results.forEach((result, index) => {
		if (result.status === "rejected") {
			logError(
				{
					msg,
					method,
					[nameKey]: names[index],
				},
				result.reason,
			);
		}
	});
}
