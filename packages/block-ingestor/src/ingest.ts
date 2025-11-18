import { type PutBlock } from "./api/put-blocks";
import { type BlockQueueRecord, kvBlocksKey } from "@gonative-cc/lib/nbtc";

/// Enequeue new blocks to the indexer processing queue.
export async function handleIngestBlocks(
	blocks: PutBlock[],
	blockStore: KVNamespace,
	blockQueue: Queue,
): Promise<void> {
	if (blocks.length === 0) {
		throw new Error("Empty block batch");
	}
	const timestamp_ms = Date.now();
	const batch: MessageSendRequest<BlockQueueRecord>[] = [];
	await Promise.all(
		blocks.map((b) => {
			const hash = b.block.getId();
			batch.push({
				body: {
					hash,
					timestamp_ms,
					height: b.height,
					network: b.network,
				},
			});
			const kvKey = kvBlocksKey(b.network, b.block.getId());
			return blockStore.put(kvKey, b.block.toBuffer());
		}),
	);

	if (batch.length > 0) {
		await blockQueue.sendBatch(batch);
	}
}
