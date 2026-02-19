import { WorkerEntrypoint } from "cloudflare:workers";
import { indexerFromEnv, Indexer } from "./btcindexer";
import { BtcNet } from "@gonative-cc/lib/nbtc";
import type { NbtcTxResp } from "./models";
import type { BtcIndexerRpc, PutNbtcTxResponse } from "./rpc-interface";

/**
 * RPC entrypoint for btcindexer worker.
 * This allows other workers to call btcindexer methods directly via RPC.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/
 */
export class RPC extends WorkerEntrypoint<Env> implements BtcIndexerRpc {
	#indexer?: Indexer;

	private async getIndexer(): Promise<Indexer> {
		if (!this.#indexer) {
			this.#indexer = await indexerFromEnv(this.env);
		}
		return this.#indexer;
	}

	/**
	 * Get the latest block height stored in the indexer.
	 * @returns Object containing the latest height (or null if no blocks exist)
	 */
	async latestHeight(network: BtcNet): Promise<{ height: number | null }> {
		const indexer = await this.getIndexer();
		return indexer.getLatestHeight(network);
	}

	/**
	 * Register a broadcasted nBTC transaction.
	 * @param txHex - The transaction hex string
	 * @param network - The Bitcoin network
	 * @returns Transaction ID and number of registered deposits
	 */
	async putNbtcTx(txHex: string, network: BtcNet): Promise<PutNbtcTxResponse> {
		const indexer = await this.getIndexer();
		return indexer.registerBroadcastedNbtcTx(txHex, network);
	}

	/**
	 * Broadcast a raw Bitcoin redemption transaction.
	 * @param txHex - The raw transaction hex
	 * @param network - The Bitcoin network
	 * @param redeemId - The ID of the redeem request
	 * @returns The transaction ID
	 */
	async broadcastRedeemTx(
		txHex: string,
		network: BtcNet,
		redeemId: number,
	): Promise<{ tx_id: string }> {
		const indexer = await this.getIndexer();
		return indexer.broadcastRedeemTx(txHex, network, redeemId);
	}

	/**
	 * Get nBTC transaction status by Bitcoin transaction ID.
	 * @param txid - Bitcoin transaction ID
	 * @param setupId - The setup ID
	 * @returns Transaction status or null if not found
	 */
	async nbtcMintTx(txid: string, setupId: number): Promise<NbtcTxResp | null> {
		const indexer = await this.getIndexer();
		return indexer.getNbtcMintTx(txid, setupId);
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
	async depositsBySender(address: string, setupId: number): Promise<NbtcTxResp[]> {
		const indexer = await this.getIndexer();
		return indexer.getDepositsBySender(address, setupId);
	}
}
