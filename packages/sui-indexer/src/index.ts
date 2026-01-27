import { SUI_GRAPHQL_URLS } from "@gonative-cc/lib/nsui";
import { SuiGraphQLClient } from "./graphql-client";
import { Processor } from "./processor";
import { D1Storage } from "./storage";
import { logError, logger } from "@gonative-cc/lib/logger";
import { RedeemService } from "./redeem-service";
import { createSuiClients } from "./redeem-sui-client";
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
		const storage = new D1Storage(env.DB, env.SETUP_ENV);
		const activeNetworks = storage.getSuiNetworks();

		// Run both indexer and redeem solver tasks in parallel
		const results = await Promise.allSettled([
			runIndexers(storage, activeNetworks),
			runRedeemSolver(storage, env, activeNetworks),
		]);

		// Check for any rejected promises and log errors
		reportErrors(results, "scheduled", "Scheduled task error", ["SuiIndexer", "RedeemSolver"]);
	},
} satisfies ExportedHandler<Env>;

async function runIndexers(storage: D1Storage, activeNetworks: SuiNet[]) {
	if (activeNetworks.length === 0) {
		logger.info({ msg: "No active packages/networks found in database." });
		return;
	}

	const networksToProcess: { net: SuiNet; gqlUrl: string }[] = [];
	for (const net of activeNetworks) {
		const gqlUrl = SUI_GRAPHQL_URLS[net];
		if (gqlUrl) {
			networksToProcess.push({ net, gqlUrl });
		} else {
			logger.warn({
				msg: "Skipping processing network: No GraphQL URL configured",
				network: net,
			});
		}
	}

	const netNames = networksToProcess.map((n) => n.net);
	logger.debug({
		msg: "Starting Indexer Loop",
		networks: netNames,
	});

	const networkJobs = networksToProcess.map((n) => runIndexerByNetwork(storage, n.net, n.gqlUrl));
	const results = await Promise.allSettled(networkJobs);
	reportErrors(results, "runSuiIndexer", "Failed to process network", netNames, "network");
}

async function runIndexerByNetwork(storage: D1Storage, net: SuiNet, gqlUrl: string) {
	const client = new SuiGraphQLClient(gqlUrl);
	const p = new Processor(storage, client, net);
	return p.run();
}

async function runRedeemSolver(storage: D1Storage, env: Env, activeNetworks: SuiNet[]) {
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

// Helper function to report errors from `Promise.allSettled` results.
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
