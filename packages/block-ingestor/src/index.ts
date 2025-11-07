import { PutBlocksReq } from "./api/put-blocks";
import { BitcoinNetwork } from "./networks";
import { BlockQueueMessage } from "./types";

export default {
	async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
		if (request.method !== "POST") {
			return new Response("Method Not Allowed", { status: 405 });
		}

		try {
			const blocks = PutBlocksReq.decode(await request.arrayBuffer());
			if (blocks.length === 0) {
				return new Response("Empty block batch", { status: 400 });
			}

			const blockMetas = blocks.map((block) => {
				const blockHash = block.block.getId();
				const kvKey = `blocks:${block.network}:${blockHash}`;
				return { block, blockHash, kvKey };
			});

			// Batch KV puts
			await Promise.all(
				blockMetas.map((meta) =>
					env.BLOCK_STORE.put(meta.kvKey, meta.block.block.toBuffer()),
				),
			);

			// Group messages by network
			const messagesByNetwork: Record<string, BlockQueueMessage[]> = {};
			for (const meta of blockMetas) {
				const message: BlockQueueMessage = {
					hash: meta.blockHash,
					height: meta.block.height,
					network: meta.block.network,
					kv_key: meta.kvKey,
				};
				if (!messagesByNetwork[meta.block.network]) {
					messagesByNetwork[meta.block.network] = [];
				}
				messagesByNetwork[meta.block.network].push(message);
			}

			// Batch queue sends for each network
			for (const network in messagesByNetwork) {
				const queue = getQueue(network as BitcoinNetwork, env);
				await queue.sendBatch(messagesByNetwork[network].map((body) => ({ body })));
			}

			return new Response("Blocks ingested successfully", { status: 200 });
		} catch (e) {
			console.error("Failed to ingest blocks", e);
			const message = e instanceof Error ? e.message : "Failed to process request";
			return new Response(message, { status: 500 });
		}
	},
};

function getQueue(network: BitcoinNetwork, env: Env): Queue {
	switch (network) {
		case BitcoinNetwork.REGTEST:
			return env.BLOCK_QUEUE_REGTEST;
		case BitcoinNetwork.TESTNET:
			return env.BLOCK_QUEUE_TESTNET;
		case BitcoinNetwork.MAINNET:
			return env.BLOCK_QUEUE_MAINNET;
		default:
			throw new Error(`Unknown network: ${network}`);
	}
}
