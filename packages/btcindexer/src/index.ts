/**
 * HTTP + Scheduled Worker: a Worker that can run on a
 * configurable interval and has HTTP server:
 * https://developers.cloudflare.com/workers/platform/triggers/cron-triggers/
 *
 * Bind resources to your Worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `pnpm run typegen`.
 */

import { indexerFromEnv } from "./btcindexer";
import HttpRouter from "./router";

const router = new HttpRouter(undefined);

export default {
	async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
		const indexer = indexerFromEnv(env);
		return router.fetch(req, env, indexer);
	},

	// The scheduled handler is invoked at the interval set in our wrangler.jsonc's
	// [[triggers]] configuration.
	async scheduled(_event: ScheduledController, env: Env, _ctx): Promise<void> {
		// A Cron Trigger can make requests to other endpoints on the Internet,
		// publish to a Queue, query a D1 Database, and much more.
		// You could store this result in KV, write to a D1 Database, or publish to a Queue.
		// In this template, we'll just log the result:

		// TODO:  This should be refactored probably the best is to use chain tip stored in a KV namespace.
		// ideally use queue
		const d1 = env.DB;
		// TODO: move this to the indexer directly
		const latestBlock = await d1
			.prepare("SELECT MAX(height) as latest_height FROM processed_blocks")
			.first<{ latest_height: number }>();

		const indexer = indexerFromEnv(env);
		if (latestBlock && latestBlock.latest_height) {
			await indexer.updateConfirmationsAndFinalize(latestBlock.latest_height);
		}
		await indexer.scanNewBlocks();
		await indexer.processFinalizedTransactions();
	},
} satisfies ExportedHandler<Env>;
