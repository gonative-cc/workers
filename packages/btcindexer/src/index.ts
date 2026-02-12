/**
 * HTTP + Scheduled Worker: a Worker that can run on a
 * configurable interval and has HTTP server:
 * https://developers.cloudflare.com/workers/platform/triggers/cron-triggers/
 *
 * Bind resources to your Worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `bun run typegen`.
 */
import { indexerFromEnv } from "./btcindexer";
import { logError, logger } from "@gonative-cc/lib/logger";
import HttpRouter from "./router";
import { type BlockQueueRecord } from "@gonative-cc/lib/nbtc";
import { processBlockBatch } from "./queue-handler";
import { isAuthorized } from "@gonative-cc/lib/auth";

// Export RPC entrypoints for service bindings
export { RPC } from "./rpc";
export { RPCMock } from "./rpc-mock";

const router = new HttpRouter(undefined);

export default {
	async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
		try {
			if (!isAuthorized(req.headers, env.AUTH_BEARER_TOKEN)) {
				return new Response("Unauthorized", { status: 401 });
			}
			const indexer = await indexerFromEnv(env);
			return await router.fetch(req, env, indexer);
		} catch (e) {
			logError(
				{
					msg: "Unhandled exception in fetch handler",
					method: "fetch",
					url: req.url,
					httpMethod: req.method,
				},
				e,
			);
			return new Response("Internal Server Error", { status: 500 });
		}
	},

	async queue(
		batch: MessageBatch<BlockQueueRecord>,
		env: Env,
		_ctx: ExecutionContext,
	): Promise<void> {
		logger.info({
			msg: "Processing batch",
			count: batch.messages.length,
			queue: batch.queue,
		});
		// TODO: Add support for active/inactive nBTC addresses.
		// The current implementation fetches all addresses, but we need to distinguish it,
		// probably a active (boolean) column in the table.
		const indexer = await indexerFromEnv(env);
		return processBlockBatch(batch, indexer);
	},

	// the scheduled handler is invoked at the interval set in our wrangler.jsonc's
	// [[triggers]] configuration.
	async scheduled(_event: ScheduledController, env: Env, _ctx): Promise<void> {
		try {
			const indexer = await indexerFromEnv(env);
			await indexer.updateConfirmationsAndFinalize();
			await indexer.processFinalizedTransactions();
		} catch (e) {
			logError({ msg: "Cron job failed", method: "scheduled" }, e);
		}
	},
} satisfies ExportedHandler<Env, BlockQueueRecord>;
