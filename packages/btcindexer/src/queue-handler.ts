import { type MessageBatch } from "@cloudflare/workers-types";
import { type BlockQueueRecord, type BtcNet } from "@gonative-cc/lib/nbtc";
import { delay } from "@gonative-cc/lib/nbtc";
import { type Indexer } from "./btcindexer";
import { logError } from "@gonative-cc/lib/logger";

export async function processBlockBatch(
	batch: MessageBatch<BlockQueueRecord>,
	indexer: Indexer,
): Promise<void> {
	// Group by network
	const networks = new Set(batch.messages.map((m) => m.body.network));
	const trackedRedeems = new Map<BtcNet, Set<string>>();

	for (const net of networks) {
		try {
			const ids = await indexer.getBroadcastedRedeemTxIds(net);
			trackedRedeems.set(net, new Set(ids));
		} catch (error) {
			logError(
				{
					msg: "Failed to fetch tracked redeems",
					method: "processBlockBatch",
					network: net,
				},
				error,
			);
			// in case of failure we just use an empty one
			trackedRedeems.set(net, new Set());
		}
	}

	const toRetry = [];
	for (const m of batch.messages) {
		const blockInfo = m.body;
		const tracked = trackedRedeems.get(blockInfo.network);
		try {
			await indexer.processBlock(blockInfo, tracked);
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
