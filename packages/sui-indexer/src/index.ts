import { SUI_GRAPHQL_URLS } from "@gonative-cc/lib/nsui";
import { SuiGraphQLClient } from "./graphql-client";
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
		logger.debug({
			msg: "Starting sui-indexer",
			networks: activeNetworks,
		});

		const mnemonic = await getSecret(env.NBTC_MINTING_SIGNER_MNEMONIC);
		const suiClients = await createSuiClients(activeNetworks, mnemonic);
		if (suiClients.length === 0) {
			logger.info({ msg: "No active packages/networks found in database." });
			return;
		}

		// Run both indexer and redeem solver tasks in parallel
		const results = await Promise.allSettled([
			runIndexers(storage, suiClients),
			runRedeemSolver(storage, env, suiClients),
		]);

		// Check for any rejected promises and log errors
		reportErrors(results, "scheduled", "Scheduled task error", ["SuiIndexer", "RedeemSolver"]);
	},
} satisfies ExportedHandler<Env>;

async function runIndexers(storage: D1Storage, suiClients: [SuiNet, SuiClient][]) {
	const indexers: Processor[] = [];
	const taskNames = [];
	for (const sc of suiClients) {
		const net = sc[0];
		const gqlUrl = SUI_GRAPHQL_URLS[net];
		if (!gqlUrl) {
			logger.warn({
				msg: "Skipping processing network: No GraphQL URL configured",
				network: net,
			});
			continue;
		}
		const gql = new SuiGraphQLClient(gqlUrl);
		indexers.push(new Processor(net, storage, sc[1], gql));
		taskNames.push(net + " Processor.run");
	}
	const jobs = indexers.map((p) => p.run());
	const results = await Promise.allSettled(jobs);
	reportErrors(results, "runSuiIndexers", "Indexer run failure", taskNames);
}

async function runRedeemSolver(
	storage: D1Storage,
	env: Env,
	suiClients: [SuiNet, SuiClient][],
) {
	logger.info({ msg: "Running scheduled redeem solver task..." });
	const rs = new RedeemService(
		storage,
		suiClients,
		env.BtcIndexer as unknown as Service<BtcIndexerRpc & WorkerEntrypoint>,
		env.UTXO_LOCK_TIME,
		env.REDEEM_DURATION_MS,
	);

	const results: PromiseSettledResult<void>[] = [];
	results.push(await tryAsync(rs.refillPresignPool()));
	results.push(await tryAsync(rs.processPendingRedeems()));
	results.push(
		await tryAsync(
			(async () => {
				await rs.solveReadyRedeems();
				await rs.processSigningRedeems();
			})(),
		),
	);

	results.push(await tryAsync(rs.broadcastReadyRedeems()));

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

// Helper function to check for rejected promises and report errors from `Promise.allSettled` results.
function reportErrors(
	results: PromiseSettledResult<unknown>[],
	method: string,
	msg: string,
	names: string[],
) {
	results.forEach((result, idx) => {
		if (result.status === "rejected") {
			logError(
				{
					msg,
					method,
					task: names[idx],
				},
				result.reason,
			);
		}
	});
}
