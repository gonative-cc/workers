/**
 * HTTP + Scheduled Worker: a Worker that can run on a
 * configurable interval and has HTTP server:
 * https://developers.cloudflare.com/workers/platform/triggers/cron-triggers/
 *
 * Bind resources to your Worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `bun run typegen`.
 */

import { indexerFromEnv } from "./btcindexer";
import { toSerializableError } from "./errutils";
import HttpRouter from "./router";

const router = new HttpRouter(undefined);

export default {
	async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
		try {
			const indexer = await indexerFromEnv(env);
			return await router.fetch(req, env, indexer);
		} catch (e) {
			console.error({
				msg: "Unhandled exception in fetch handler",
				error: toSerializableError(e),
				url: req.url,
				method: req.method,
			});
			return new Response("Internal Server Error", { status: 500 });
		}
	},

	// the scheduled handler is invoked at the interval set in our wrangler.jsonc's
	// [[triggers]] configuration.
	async scheduled(_event: ScheduledController, env: Env, _ctx): Promise<void> {
		// A Cron Trigger can make requests to other endpoints on the Internet,
		// publish to a Queue, query a D1 Database, and much more.
		// You could store this result in KV, write to a D1 Database, or publish to a Queue.
		// In this template, we'll just log the result:

		// TODO:  This should be refactored probably the best is to use chain tip stored in a KV namespace.
		// ideally use queue
		console.trace({ msg: "Cron job starting" });
		try {
			const d1 = env.DB;
			// TODO: move this to the indexer directly
			const latestBlock = await d1
				.prepare("SELECT MAX(height) as latest_height FROM btc_blocks")
				.first<{ latest_height: number }>();

			const indexer = await indexerFromEnv(env);
			if (latestBlock && latestBlock.latest_height) {
				await indexer.updateConfirmationsAndFinalize(latestBlock.latest_height);
			}
			await indexer.scanNewBlocks(env);
			await indexer.processFinalizedTransactions();
			console.log({ msg: "Cron job finished successfully" });
		} catch (e) {
			console.error({
				msg: "Cron job failed",
				error: toSerializableError(e),
			});
		}
	},
} satisfies ExportedHandler<Env>;
