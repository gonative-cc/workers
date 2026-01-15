import { SUI_NETWORK_URLS } from "./config";
import { SuiGraphQLClient } from "./graphql-client";
import type { NetworkConfig } from "./models";
import { Processor } from "./processor";
import { IndexerStorage } from "./storage";
import { logError, logger } from "@gonative-cc/lib/logger";

export default {
	async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
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

		logger.debug({
			msg: "Starting Indexer Loop",
			networks: networksToProcess.map((n) => n.name),
		});

		const networkJobs = networksToProcess.map((netCfg) =>
			poolAndProcessEvents(netCfg, storage),
		);
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
	await p.pollAllEvents(packages);
}
