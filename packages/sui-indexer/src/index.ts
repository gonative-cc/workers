import { SuiGraphQLClient } from "./graphql-client";
import { handleMintEvents } from "./handler";
import type { MintEventNode, NetworkConfig } from "./models";
import { IndexerStorage } from "./storage";
import { logger } from "@gonative-cc/lib/logger";

export default {
	async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		const networks = getNetworksFromEnv(env);
		if (networks.length === 0) {
			logger.warn({ msg: "No networks configured in environment variables" });
			return;
		}
		logger.info({
			msg: "Starting Indexer Loop",
			networks: networks.map((n) => n.name),
		});
		const networkJobs = networks.map((network) => processNetwork(network, env));
		await Promise.allSettled(networkJobs);
	},
} satisfies ExportedHandler<Env>;

async function processNetwork(network: NetworkConfig, env: Env) {
	const client = new SuiGraphQLClient(network.url);
	const storage = new IndexerStorage(env.DB);

	const packages = await env.DB.prepare(
		"SELECT nbtc_pkg FROM nbtc_addresses WHERE sui_network = ? AND is_active = 1",
	)
		.bind(network.name)
		.all<{ nbtc_pkg: string }>();
	if (!packages.results || packages.results.length === 0) return;

	logger.info({
		msg: `Processing network`,
		network: network.name,
		packageCount: packages.results.length,
	});

	const packageJobs = packages.results.map(async (pkg) => {
		const pkgId = pkg.nbtc_pkg;
		try {
			const cursor = await storage.getCursor(pkgId);
			const { events, nextCursor } = await client.fetchMintEvents(pkgId, cursor);
			if (events.length > 0) {
				await handleMintEvents(events as MintEventNode[], storage, pkgId, network.name);
			}
			if (nextCursor && nextCursor !== cursor) {
				await storage.saveCursor(pkgId, nextCursor);
			}
		} catch (e) {
			logger.error({
				msg: "Failed to index package",
				network: network.name,
				pkgId,
				error: e,
			});
		}
	});

	await Promise.allSettled(packageJobs);
}

function getNetworksFromEnv(env: Env): NetworkConfig[] {
	const networks: NetworkConfig[] = [];
	if (env.SUI_GRAPHQL_URL_TESTNET) {
		networks.push({ name: "testnet", url: env.SUI_GRAPHQL_URL_TESTNET });
	}
	if (env.SUI_GRAPHQL_URL_MAINNET) {
		networks.push({ name: "mainnet", url: env.SUI_GRAPHQL_URL_MAINNET });
	}

	return networks;
}
