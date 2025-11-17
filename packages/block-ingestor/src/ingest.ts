import { type PutBlock } from "./api/put-blocks";
import { BitcoinNetwork, type BlockQueueMessage } from "@gonative-cc/lib/bitcoin";

export async function handleIngestBlocks(
	blocks: PutBlock[],
	blockStore: KVNamespace,
	blockQueue: Queue,
): Promise<void> {
	if (blocks.length === 0) {
		throw new Error("Empty block batch");
	}

	const blockMetas = blocks.map((block) => {
		const blockHash = block.block.getId();
		const kvKey = `blocks:${block.network}:${blockHash}`;
		return { block, blockHash, kvKey };
	});

	// Batch KV puts
	await Promise.all(
		blockMetas.map((meta) => blockStore.put(meta.kvKey, meta.block.block.toBuffer())),
	);

	const messages: BlockQueueMessage[] = [];
	for (const meta of blockMetas) {
		messages.push({
			hash: meta.blockHash,
			height: meta.block.height,
			network: meta.block.network,
			kv_key: meta.kvKey,
		});
	}

	// Enqueue parsing requests
	if (messages.length > 0) {
		await blockQueue.sendBatch(messages.map((body: BlockQueueMessage) => ({ body })));
	}
}
