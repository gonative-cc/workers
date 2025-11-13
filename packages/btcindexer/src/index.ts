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
import { BtcIndexerRpc } from "./rpc";
import { fetchNbtcAddresses } from "./storage";
import { NbtcAddress, BlockQueueMessage } from "./models";
import { CFStorage } from "./cf-storage";

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
			console.error({
				msg: "Unhandled exception in fetch handler",
				error: toSerializableError(e),
				url: req.url,
				method: req.method,
			});
			return new Response("Internal Server Error", { status: 500 });
		}
	},

	async queue(
		batch: MessageBatch<BlockQueueMessage>,
		env: Env,
		_ctx: ExecutionContext,
	): Promise<void> {
		console.log(`Processing batch of ${batch.messages.length} messages from ${batch.queue}`);
		const nbtcAddresses = await fetchNbtcAddresses(env.DB);
		const nbtcAddressesMap = new Map<string, NbtcAddress>(
			nbtcAddresses.map((addr) => [addr.btc_address, addr]),
		);
		const storage = new CFStorage(env.DB, env.btc_blocks, env.nbtc_txs);
		const indexer = await indexerFromEnv(env, nbtcAddressesMap);

		for (const message of batch.messages) {
			try {
				await storage.insertBlockFromQueue(message.body);
				await indexer.processBlock(message.body);
				await message.ack();
			} catch (e) {
				console.error("Failed to process block", toSerializableError(e));
				await message.retry();
			}
		}
	},

	// the scheduled handler is invoked at the interval set in our wrangler.jsonc's
	// [[triggers]] configuration.
	async scheduled(_event: ScheduledController, env: Env, _ctx): Promise<void> {
		console.trace({ msg: "Cron job starting" });
		try {
			const nbtcAddresses = await fetchNbtcAddresses(env.DB);
			const nbtcAddressesMap = new Map<string, NbtcAddress>(
				nbtcAddresses.map((addr) => [addr.btc_address, addr]),
			);
			console.log(
				`Loaded ${nbtcAddressesMap.size} nbtc addresses into memory for scheduled job.`,
			);

			const indexer = await indexerFromEnv(env, nbtcAddressesMap);
			const latestBlock = await env.DB.prepare(
				"SELECT MAX(height) as latest_height FROM btc_blocks",
			).first<{ latest_height: number }>();

			if (latestBlock && latestBlock.latest_height) {
				await indexer.updateConfirmationsAndFinalize(latestBlock.latest_height);
			}
			await indexer.processFinalizedTransactions();
			console.log({ msg: "Cron job finished successfully" });
		} catch (e) {
			console.error({
				msg: "Cron job failed",
				error: toSerializableError(e),
			});
		}
	},
} satisfies ExportedHandler<Env, BlockQueueMessage>;

// Export RPC entrypoints for service bindings
// Use BtcIndexerRpc for production, BtcIndexerRpcMock for local development/testing
export { BtcIndexerRpc };
export { BtcIndexerRpcMock } from "./rpc-mock";
