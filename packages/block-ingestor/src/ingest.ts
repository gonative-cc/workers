import { type PutBlock } from "./api/put-blocks";
import { BitcoinNetwork, type BlockQueueMessage } from "@gonative-cc/lib/bitcoin";

export async function handleIngestBlocks(
	blocks: PutBlock[],
	blockStore: KVNamespace,
	queues: Map<BitcoinNetwork, Queue>,
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

	// Group messages by network
	const messagesByNetwork: Partial<Record<BitcoinNetwork, BlockQueueMessage[]>> = {};
	for (const meta of blockMetas) {
		const message: BlockQueueMessage = {
			hash: meta.blockHash,
			height: meta.block.height,
			network: meta.block.network,
			kv_key: meta.kvKey,
		};
		messagesByNetwork[meta.block.network] ??= [];
		const messages = messagesByNetwork[meta.block.network];
		if (messages) {
			messages.push(message);
		}
	}

	// Enqueue parsing requests
	for (const networkStr in messagesByNetwork) {
		const network = networkStr as BitcoinNetwork;
		const queue = queues.get(network);
		if (!queue) {
			throw new Error(`No queue found for network: ${network}`);
		}
		const messages = messagesByNetwork[network];
		if (messages) {
			await queue.sendBatch(messages.map((body: BlockQueueMessage) => ({ body })));
		}
	}
}
