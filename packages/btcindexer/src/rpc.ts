import { WorkerEntrypoint } from "cloudflare:workers";
import { indexerFromEnv, Indexer } from "./btcindexer";
import type { PutBlocks } from "./api/put-blocks";
import type { NbtcAddress, NbtcTxResp } from "./models";
import { fetchNbtcAddresses } from "./storage";
import type { BtcIndexerRpcI } from "./rpc-interface";

/**
 * RPC entrypoint for btcindexer worker.
 * This allows other workers to call btcindexer methods directly via RPC.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/
 */
export class BtcIndexerRpc extends WorkerEntrypoint<Env> implements BtcIndexerRpcI {
	#indexer?: Indexer;

	private async getIndexer(): Promise<Indexer> {
		if (!this.#indexer) {
			const nbtcAddresses = await fetchNbtcAddresses(this.env.DB);
			const nbtcAddressesMap = new Map<string, NbtcAddress>(
				nbtcAddresses.map((addr) => [addr.btc_address, addr]),
			);
			this.#indexer = await indexerFromEnv(this.env, nbtcAddressesMap);
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
		return indexer.putBlocks(blocks);
	}

	/**
	 * Get the latest block height stored in the indexer.
	 * @returns Object containing the latest height (or null if no blocks exist)
	 */
	async latestHeight(): Promise<{ height: number | null }> {
		const indexer = await this.getIndexer();
		return indexer.getLatestHeight();
	}

	/**
	 * Register a broadcasted nBTC transaction.
	 * @param txHex - The transaction hex string
	 * @returns Transaction ID and number of registered deposits
	 */
	async putNbtcTx(txHex: string): Promise<{ tx_id: string; registered_deposits: number }> {
		const indexer = await this.getIndexer();
		return indexer.registerBroadcastedNbtcTx(txHex);
	}

	/**
	 * Get nBTC transaction status by Bitcoin transaction ID.
	 * @param txid - Bitcoin transaction ID
	 * @returns Transaction status or null if not found
	 */
	async nbtcMintTx(txid: string): Promise<NbtcTxResp | null> {
		const indexer = await this.getIndexer();
		return indexer.getNbtcMintTx(txid);
	}

	/**
	 * Get all nBTC transactions for a specific Sui address.
	 * @param suiAddress - Sui recipient address
	 * @returns Array of transaction statuses
	 */
	async nbtcMintTxsBySuiAddr(suiAddress: string): Promise<NbtcTxResp[]> {
		const indexer = await this.getIndexer();
		return indexer.getNbtcMintTxsBySuiAddr(suiAddress);
	}

	/**
	 * Returns deposit transaction statuses by Bitcoin sender address
	 */
	async depositsBySender(address: string): Promise<NbtcTxResp[]> {
		const indexer = await this.getIndexer();
		return indexer.getDepositsBySender(address);
	}
}
