import { SuiGraphQLClient } from "./graphql-client";
import { handleMintEvents } from "./handler";
import { IndexerStorage } from "./storage";
import { logger } from "@gonative-cc/lib/logger";

export default {
	async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		const client = new SuiGraphQLClient(env.SUI_GRAPHQL_URL);

		const storage = new IndexerStorage(env.DB);

		//NOTE: assumption there wont be any mint events for inactive depoist addresses
		// so if we have a nbtc package that has been completely deprecated (all its addresses are inactive) we wont process its events anymore
		const packages = await env.DB.prepare(
			"SELECT nbtc_pkg FROM nbtc_addresses WHERE sui_network = ? AND active = 1",
		)
			.bind(env.SUI_NETWORK)
			.all<{ nbtc_pkg: string }>();

		if (!packages.results || packages.results.length === 0) return;

		const jobs = packages.results.map(async (pkg) => {
			const pkgId = pkg.nbtc_pkg;
			try {
				const cursor = await storage.getCursor(pkgId);
				const { events, nextCursor } = await client.fetchMintEvents(pkgId, cursor);

				if (events.length > 0) {
					await handleMintEvents(events, storage, pkgId, env.SUI_NETWORK);
				}

				if (nextCursor && nextCursor !== cursor) {
					await storage.saveCursor(pkgId, nextCursor);
				}
			} catch (e) {
				logger.error({ msg: "Failed to index package", pkgId, error: e });
			}
		});

		await Promise.allSettled(jobs);
	},
} satisfies ExportedHandler<Env>;
