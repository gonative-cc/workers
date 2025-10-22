import { WorkerEntrypoint } from "cloudflare:workers";
import { indexerFromEnv, Indexer } from "./btcindexer";
import { PutBlocks } from "./api/put-blocks";

/**
 * RPC entrypoint for btcindexer worker.
 * This allows other workers to call btcindexer methods directly via RPC.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/
 */
export class BtcIndexerRpc extends WorkerEntrypoint<Env> {
	#indexer?: Indexer;

	private async getIndexer(): Promise<Indexer> {
		if (!this.#indexer) {
			this.#indexer = await indexerFromEnv(this.env);
		}
		return this.#indexer;
	}

	/**
	 * Store new Bitcoin blocks in the indexer.
	 * @param blocks - Array of blocks to store
	 * @returns Number of blocks inserted
	 */
	async putBlocks(blocks: PutBlocks[]): Promise<number> {
		const indexer = await this.getIndexer();
		return await indexer.putBlocks(blocks);
	}

	/**
	 * Get the latest block height stored in the indexer.
	 * @returns Object containing the latest height (or null if no blocks exist)
	 */
	async latestHeight(): Promise<{ height: number | null }> {
		const indexer = await this.getIndexer();
		return await indexer.getLatestHeight();
	}

	/**
	 * Register a broadcasted nBTC transaction.
	 * @param txHex - The transaction hex string
	 * @returns Transaction ID and number of registered deposits
	 */
	async registerBroadcastedNbtcTx(
		txHex: string,
	): Promise<{ tx_id: string; registered_deposits: number }> {
		const indexer = await this.getIndexer();
		return await indexer.registerBroadcastedNbtcTx(txHex);
	}

	/**
	 * Get nBTC transaction status by Bitcoin transaction ID.
	 * @param txid - Bitcoin transaction ID
	 * @returns Transaction status or null if not found
	 */
	async statusByTxid(txid: string): Promise<NbtcTxStatusResp | null> {
		const indexer = await this.getIndexer();
		return await indexer.getStatusByTxid(txid);
	}

	/**
	 * Get all nBTC transactions for a specific Sui address.
	 * @param suiAddress - Sui recipient address
	 * @returns Array of transaction statuses
	 */
	async statusBySuiAddress(suiAddress: string): Promise<NbtcTxStatusResp[]> {
		const indexer = await this.getIndexer();
		return await indexer.getStatusBySuiAddress(suiAddress);
	}
}
