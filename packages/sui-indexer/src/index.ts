import type { SuiNet } from "@gonative-cc/lib/nsui";
import { SUI_NETWORK_URLS } from "./config";
import { SuiGraphQLClient } from "./graphql-client";
import { handleEvents } from "./handler";
import type { SuiEventNode, NetworkConfig } from "./models";
import { IndexerStorage } from "./storage";
import { logError, logger } from "@gonative-cc/lib/logger";

export default {
	async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		const storage = new IndexerStorage(env.DB);
		const dbNetworks = await storage.getActiveNetworks();

		if (dbNetworks.length === 0) {
			logger.info({ msg: "No active packages/networks found in database." });
			return;
		}

		const networksToProcess: NetworkConfig[] = [];

		for (const netName of dbNetworks) {
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

		logger.info({
			msg: "Starting Indexer Loop",
			networks: networksToProcess.map((n) => n.name),
		});

		const networkJobs = networksToProcess.map((network) => queryNewEvents(network, storage));
		const results = await Promise.allSettled(networkJobs);
		results.forEach((result, idx) => {
			if (result.status === "rejected") {
				logError({
					msg: "Failed to process network",
					method: "scheduled",
					network: networksToProcess[idx]?.name,
					error: result.reason,
				});
			}
		});
	},
} satisfies ExportedHandler<Env>;

async function queryNewEvents(network: NetworkConfig, storage: IndexerStorage) {
	const client = new SuiGraphQLClient(network.url);
	const packages = await storage.getActivePackages(network.name);
	if (packages.length === 0) return;
	logger.info({
		msg: `Processing network`,
		network: network.name,
		packageCount: packages.length,
	});

	const packageJobs = packages.map(async (pkgId) => {
		try {
			const cursor = await storage.getSuiGqlCursor(pkgId);
			const { events, nextCursor } = await client.fetchEvents(pkgId, cursor); // TODO: lets fetch events from all active packages at once
			if (events.length > 0) {
				await handleEvents(events, storage, pkgId, network.name);
			}
			if (nextCursor && nextCursor !== cursor) {
				await storage.saveSuiGqlCursor(pkgId, nextCursor);
			}
		} catch (e) {
			logError(
				{
					msg: "Failed to index package",
					method: "queryNewEvents",
					network: network.name,
					pkgId,
				},
				e,
			);
		}
	});

	await Promise.allSettled(packageJobs);
}
