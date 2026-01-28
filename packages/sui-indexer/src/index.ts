import { SUI_GRAPHQL_URLS } from "@gonative-cc/lib/nsui";
import { SuiGraphQLClient } from "./graphql-client";
import type { NetworkConfig } from "./models";
import { Processor } from "./processor";
import { D1Storage } from "./storage";
import { logError, logger } from "@gonative-cc/lib/logger";
import { RedeemService } from "./redeem-service";
import { createSuiClients, type SuiClient } from "./redeem-sui-client";
import type { Service } from "@cloudflare/workers-types";
import type { WorkerEntrypoint } from "cloudflare:workers";
import type { BtcIndexerRpc } from "@gonative-cc/btcindexer/rpc-interface";
import HttpRouter from "./redeem-router";
import type { SuiNet } from "@gonative-cc/lib/nsui";

const router = new HttpRouter();

// Export RPC entrypoints for service bindings
export { RPC } from "./rpc";
export { RPCMock } from "./rpc-mocks";

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return router.fetch(request, env, ctx);
	},
	async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
		const storage = new D1Storage(env.DB);
		const activeNetworks = await storage.getActiveNetworks();

		let mnemonic: string;
		try {
			mnemonic = (await env.NBTC_MINTING_SIGNER_MNEMONIC.get()) || "";
		} catch (error) {
			logger.error({ msg: "Failed to retrieve NBTC_MINTING_SIGNER_MNEMONIC", error });
			return;
		}
		if (!mnemonic) {
			logger.error({ msg: "Missing NBTC_MINTING_SIGNER_MNEMONIC" });
			return;
		}
		const suiClients = await createSuiClients(activeNetworks, mnemonic);

		// Run both indexer and redeem solver tasks in parallel
		const results = await Promise.allSettled([
			runSuiIndexer(storage, activeNetworks, suiClients),
			runRedeemSolver(storage, env, suiClients),
		]);

		// Check for any rejected promises and log errors
		reportErrors(results, "scheduled", "Scheduled task error", ["SuiIndexer", "RedeemSolver"]);
	},
} satisfies ExportedHandler<Env>;

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
	const client = new SuiGraphQLClient(netCfg.url);
	const suiClient = suiClients.get(netCfg.name);
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

async function runRedeemSolver(storage: D1Storage, env: Env, suiClients: Map<SuiNet, SuiClient>) {
	logger.info({ msg: "Running scheduled redeem solver task..." });
	const service = new RedeemService(
		storage,
		suiClients,
		env.BtcIndexer as unknown as Service<BtcIndexerRpc & WorkerEntrypoint>,
		env.UTXO_LOCK_TIME,
		env.REDEEM_DURATION_MS,
	);

	const results = await Promise.allSettled([
		service.processPendingRedeems(), // propose a solution
		service
			.solveReadyRedeems() // trigger status change
			.then(() => service.processSolvedRedeems()), // request signatures
		service.broadcastReadyRedeems(), // broadcast fully signed txs
	]);

	// Check for any rejected promises and log errors
	reportErrors(results, "runRedeemSolver", "Processing redeems error", [
		"processPendingRedeems",
		"solveReadyRedeems/processSolvedRedeems",
		"broadcastReadyRedeems",
	]);
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
