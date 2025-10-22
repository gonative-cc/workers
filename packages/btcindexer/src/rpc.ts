import { WorkerEntrypoint } from "cloudflare:workers";
import { Indexer } from "./btcindexer";
import { PutBlocks } from "./api/put-blocks";
import { TxStatusResp } from "./models";

/**
 * RPC entrypoint for btcindexer worker.
 * This allows other workers to call btcindexer methods directly via RPC.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/
 */
export class BtcIndexerRpc extends WorkerEntrypoint<Env> {
	indexer: Indexer;

	constructor(ctx: ExecutionContext, env: Env, indexer: Indexer) {
		super(ctx, env);
		this.indexer = indexer;
	}

	/**
	 * Store new Bitcoin blocks in the indexer.
	 * @param blocks - Array of blocks to store
	 * @returns Number of blocks inserted
	 */
	putBlocks(blocks: PutBlocks[]): Promise<number> {
		return this.indexer.putBlocks(blocks);
	}

	/**
	 * Get the latest block height stored in the indexer.
	 * @returns Object containing the latest height (or null if no blocks exist)
	 */
	latestHeight(): Promise<{ height: number | null }> {
		return this.indexer.getLatestHeight();
	}

	/**
	 * Register a broadcasted nBTC transaction.
	 * @param txHex - The transaction hex string
	 * @returns Transaction ID and number of registered deposits
	 */
	registerBroadcastedNbtcTx(
		txHex: string,
	): Promise<{ tx_id: string; registered_deposits: number }> {
		return this.indexer.registerBroadcastedNbtcTx(txHex);
	}

	/**
	 * Get nBTC transaction status by Bitcoin transaction ID.
	 * @param txid - Bitcoin transaction ID
	 * @returns Transaction status or null if not found
	 */
	nbtcStatusByTxid(txid: string): Promise<TxStatusResp | null> {
		return this.indexer.getStatusByTxid(txid);
	}

	/**
	 * Get all nBTC transactions for a specific Sui address.
	 * @param suiAddress - Sui recipient address
	 * @returns Array of transaction statuses
	 */
	nbtcStatusBySuiAddress(suiAddress: string): Promise<TxStatusResp[]> {
		return this.indexer.getStatusBySuiAddress(suiAddress);
	}
}
