import type { PutBlocks } from "./api/put-blocks";
import type { TxStatusResp } from "./models";
import { TxStatus } from "./models";
import { Transaction } from "bitcoinjs-lib";

/**
 * Base class implementing the mock RPC logic for BtcIndexerRpc.
 * This class contains the in-memory storage and business logic for the mock implementation.
 * It can be used standalone for testing or mixed into WorkerEntrypoint for runtime use.
 */
export class BtcIndexerRpcMockBase {
	// In-memory storage for mock data
	protected blocks: Map<number, PutBlocks> = new Map();
	protected transactions: Map<string, TxStatusResp> = new Map();
	protected transactionsBySuiAddress: Map<string, Set<string>> = new Map();
	protected transactionsBySender: Map<string, Set<string>> = new Map();

	/**
	 * Store new Bitcoin blocks in the indexer.
	 * @param blocks - Array of blocks to store
	 * @returns Number of blocks inserted
	 */
	async putBlocks(blocks: PutBlocks[]): Promise<number> {
		let inserted = 0;
		for (const block of blocks) {
			if (!this.blocks.has(block.height)) {
				this.blocks.set(block.height, block);
				inserted++;
			}
		}
		return inserted;
	}

	/**
	 * Get the latest block height stored in the indexer.
	 * @returns Object containing the latest height (or null if no blocks exist)
	 */
	async latestHeight(): Promise<{ height: number | null }> {
		if (this.blocks.size === 0) {
			return { height: null };
		}
		const heights = Array.from(this.blocks.keys());
		const maxHeight = Math.max(...heights);
		return { height: maxHeight };
	}

	/**
	 * Register a broadcasted nBTC transaction.
	 * @param txHex - The transaction hex string
	 * @returns Transaction ID and number of registered deposits
	 */
	async putNbtcTx(txHex: string): Promise<{ tx_id: string; registered_deposits: number }> {
		try {
			const tx = Transaction.fromHex(txHex);
			const txid = tx.getId();

			// Create a mock transaction status
			const mockStatus: TxStatusResp = {
				btc_tx_id: txid,
				status: TxStatus.BROADCASTING,
				block_height: null,
				confirmations: 0,
				sui_recipient: "0x0000000000000000000000000000000000000000000000000000000000000000",
				amount_sats: 100000, // Mock amount
				sui_tx_id: null,
			};

			this.transactions.set(txid, mockStatus);

			// Mock: assume 1 deposit per transaction
			return { tx_id: txid, registered_deposits: 1 };
		} catch (error) {
			throw new Error(`Invalid transaction hex: ${error}`);
		}
	}

	/**
	 * Get nBTC transaction status by Bitcoin transaction ID.
	 * @param txid - Bitcoin transaction ID
	 * @returns Transaction status or null if not found
	 */
	async statusByTxid(txid: string): Promise<TxStatusResp | null> {
		return this.transactions.get(txid) || null;
	}

	/**
	 * Get all nBTC transactions for a specific Sui address.
	 * @param suiAddress - Sui recipient address
	 * @returns Array of transaction statuses
	 */
	async statusBySuiAddress(suiAddress: string): Promise<TxStatusResp[]> {
		const txids = this.transactionsBySuiAddress.get(suiAddress);
		if (!txids) {
			return [];
		}
		const results: TxStatusResp[] = [];
		for (const txid of txids) {
			const status = this.transactions.get(txid);
			if (status) {
				results.push(status);
			}
		}
		return results;
	}

	/**
	 * Returns deposit transaction statuses by Bitcoin sender address
	 */
	async depositsBySender(address: string): Promise<TxStatusResp[]> {
		const txids = this.transactionsBySender.get(address);
		if (!txids) {
			return [];
		}
		const results: TxStatusResp[] = [];
		for (const txid of txids) {
			const status = this.transactions.get(txid);
			if (status) {
				results.push(status);
			}
		}
		return results;
	}

	/**
	 * Helper method to add mock transaction data for testing.
	 * This is not part of the official API but useful for setting up test scenarios.
	 */
	addMockTransaction(txStatus: TxStatusResp): void {
		this.transactions.set(txStatus.btc_tx_id, txStatus);

		// Index by Sui address
		if (!this.transactionsBySuiAddress.has(txStatus.sui_recipient)) {
			this.transactionsBySuiAddress.set(txStatus.sui_recipient, new Set());
		}
		this.transactionsBySuiAddress.get(txStatus.sui_recipient)!.add(txStatus.btc_tx_id);
	}

	/**
	 * Helper method to add mock sender data for testing.
	 * This is not part of the official API but useful for setting up test scenarios.
	 */
	addMockSender(btcAddress: string, txid: string): void {
		if (!this.transactionsBySender.has(btcAddress)) {
			this.transactionsBySender.set(btcAddress, new Set());
		}
		this.transactionsBySender.get(btcAddress)!.add(txid);
	}
}
