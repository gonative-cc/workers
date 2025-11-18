import { type MessageBatch } from "@cloudflare/workers-types";
import { type BlockQueueRecord } from "@gonative-cc/lib/nbtc";
import { delay } from "@gonative-cc/lib/nbtc";
import { type Indexer } from "./btcindexer";
import { type Storage } from "./storage";
import { toSerializableError } from "./errutils";

export async function processBlockBatch(
	batch: MessageBatch<BlockQueueRecord>,
	storage: Storage,
	indexer: Indexer,
): Promise<void> {
	// TODO: Implement robust reorg handling.
	// The current logic can lead to a critical bug where a stale, retried block message
	// overwrites a newer, correct block after a reorg.
	// Scenario:
	// 1. `block_100` is enqueued.
	// 2. Processing of `block_100` fails (e.g., due to KV delay), and it's put back into the queue for retry.
	// 3. A reorg happens. `block_100_new` (the new canonical block at height 100) is enqueued and processed successfully.
	//    The `btc_blocks` table now correctly stores `block_100_new`.
	// 4. The retried message for `block_100` (the old one) comes up for processing.
	// 5. The current `insertBlockInfo` logic will overwrite `block_100_new` with `block_100`,
	//    leading to data inconsistency and potential issues with transaction finalization.
	const toRetry = [];
	for (const blockInfo of batch.messages) {
		const blockMessage = blockInfo.body;
		try {
			await storage.insertBlockInfo(blockMessage);
			await indexer.processBlock(blockMessage);
			await blockInfo.ack();
		} catch (e) {
			console.error("Failed to process block", toSerializableError(e));
			toRetry.push(blockInfo);
		}
	}
	if (toRetry.length === 0) return;
	await delay(200);
	toRetry.forEach((br) => br.retry());
}
