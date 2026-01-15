import { SUI_NETWORK_URLS } from "./config";
import { SuiGraphQLClient } from "./graphql-client";
import type { NetworkConfig } from "./models";
import { Processor } from "./processor";
import { IndexerStorage } from "./storage";
import { logError, logger } from "@gonative-cc/lib/logger";
import { RedeemService } from "./redeem-service";
import { createSuiClients } from "./redeem-sui-client";
import type { Service } from "@cloudflare/workers-types";
import type { WorkerEntrypoint } from "cloudflare:workers";
import type { BtcIndexerRpcI } from "@gonative-cc/btcindexer/rpc-interface";
import HttpRouter from "./redeem-router";
import type { SuiNet } from "@gonative-cc/lib/nsui";

const router = new HttpRouter();

// Export RPC entrypoints for service bindings
export { RPC } from "./redeem-rpc";
export { RPCMock } from "./redeem-rpc-mock";

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return router.fetch(request, env, ctx);
	},
	async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
		const storage = new IndexerStorage(env.DB);
		const activeNetworks = await storage.getActiveNetworks();

		// Run both indexer and redeem solver tasks in parallel
		const results = await Promise.allSettled([
			runSuiIndexer(storage, env, activeNetworks),
			runRedeemSolver(storage, env, activeNetworks),
		]);

		// Check for any rejected promises and log errors
		results.forEach((result, index) => {
			if (result.status === "rejected") {
				const taskName = index === 0 ? "SuiIndexer" : "RedeemSolver";
				logError(
					{
						msg: "Scheduled task error",
						method: "scheduled",
						task: taskName,
					},
					result.reason,
				);
			}
		});
	},
} satisfies ExportedHandler<Env>;

async function runSuiIndexer(storage: IndexerStorage, env: Env, activeNetworks: SuiNet[]) {
	if (activeNetworks.length === 0) {
		logger.info({ msg: "No active packages/networks found in database." });
		return;
	}

	const networksToProcess: NetworkConfig[] = [];
	for (const netName of activeNetworks) {
		const url = SUI_NETWORK_URLS[netName];
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

	const networkJobs = networksToProcess.map((netCfg) => poolAndProcessEvents(netCfg, storage));
	const results = await Promise.allSettled(networkJobs);
	results.forEach((result, idx) => {
		if (result.status === "rejected") {
			logError({
				msg: "Failed to process network",
				method: "runSuiIndexer",
				network: networksToProcess[idx]?.name,
				error: result.reason,
			});
		}
	});
}

async function poolAndProcessEvents(netCfg: NetworkConfig, storage: IndexerStorage) {
	const client = new SuiGraphQLClient(netCfg.url);
	const packages = await storage.getActiveNbtcPkgs(netCfg.name);
	if (packages.length === 0) return;
	logger.info({
		msg: `Processing network`,
		network: netCfg.name,
		packageCount: packages.length,
	});
	const p = new Processor(netCfg, storage, client);
	await p.pollAllNbtcEvents(packages);
}

async function runRedeemSolver(storage: IndexerStorage, env: Env, activeNetworks: SuiNet[]) {
	logger.info({ msg: "Running scheduled redeem solver task..." });
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
	const clients = await createSuiClients(activeNetworks, mnemonic);
	const service = new RedeemService(
		storage,
		clients,
		env.BTCINDEXER as unknown as Service<BtcIndexerRpcI & WorkerEntrypoint>,
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
	results.forEach((result, index) => {
		if (result.status === "rejected") {
			let taskName = "unknown";
			if (index === 0) taskName = "processPendingRedeems";
			else if (index === 1) taskName = "solveReadyRedeems/processSolvedRedeems";
			else if (index === 2) taskName = "broadcastReadyRedeems";
			logError(
				{
					msg: "Processing redeems error",
					method: "runRedeemSolver",
					task: taskName,
				},
				result.reason,
			);
		}
	});
}
