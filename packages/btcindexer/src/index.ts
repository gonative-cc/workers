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
import { fetchNbtcAddresses } from "./storage";
import type { NbtcAddress } from "./models";

const router = new HttpRouter(undefined);

export default {
	async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
		try {
			const nbtcAddresses = await fetchNbtcAddresses(env.DB);
			const nbtcAddressesMap = new Map<string, NbtcAddress>(
				nbtcAddresses.map((addr) => [addr.btc_address, addr]),
			);
			const indexer = await indexerFromEnv(env, nbtcAddressesMap);
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

	// the scheduled handler is invoked at the interval set in our wrangler.jsonc's
	// [[triggers]] configuration.
	async scheduled(_event: ScheduledController, env: Env, _ctx): Promise<void> {
		logger.debug({ msg: "Cron job starting" });
		try {
			const nbtcAddresses = await fetchNbtcAddresses(env.DB);
			const nbtcAddressesMap = new Map<string, NbtcAddress>(
				nbtcAddresses.map((addr) => [addr.btc_address, addr]),
			);
			logger.info({
				msg: "Loaded nbtc addresses into memory for scheduled job",
				count: nbtcAddressesMap.size,
			});

			const indexer = await indexerFromEnv(env, nbtcAddressesMap);
			const latestBlock = await env.DB.prepare(
				"SELECT MAX(height) as latest_height FROM btc_blocks",
			).first<{ latest_height: number }>();

			if (latestBlock && latestBlock.latest_height) {
				await indexer.updateConfirmationsAndFinalize(latestBlock.latest_height);
			}
			await indexer.scanNewBlocks();
			await indexer.processFinalizedTransactions();
			logger.info({ msg: "Cron job finished successfully" });
		} catch (e) {
			logError({ msg: "Cron job failed", method: "scheduled" }, e);
		}
	},
} satisfies ExportedHandler<Env>;

// Export RPC entrypoints for service bindings
// Use BtcIndexerRpc for production, BtcIndexerRpcMock for local development/testing
export { BtcIndexerRpc } from "./rpc";
export { BtcIndexerRpcMock } from "./rpc-mock";
