import { type MessageBatch } from "@cloudflare/workers-types";
import { type BlockQueueRecord } from "@gonative-cc/lib/nbtc";
import { delay } from "@gonative-cc/lib/nbtc";
import { type Indexer } from "./btcindexer";
import { logError } from "@gonative-cc/lib/logger";

export async function processBlockBatch(
	batch: MessageBatch<BlockQueueRecord>,
	indexer: Indexer,
): Promise<void> {
	const toRetry = [];
	for (const m of batch.messages) {
		const blockInfo = m.body;
		try {
			await indexer.processBlock(blockInfo);
			m.ack();
		} catch (e) {
			logError(
				{
					msg: "Failed to process block",
					method: "processBlockBatch",
					blockHash: blockInfo.hash,
					blockHeight: blockInfo.height,
					network: blockInfo.network,
				},
				e,
			);
			toRetry.push(m);
		}
	}
	if (toRetry.length === 0) return;
	// push back the block to the queue after a small delay to retry blocks that could not be
	// processed due to the time difference of the KV store propagation.
	await delay(200);
	toRetry.forEach((m) => m.retry());
}
