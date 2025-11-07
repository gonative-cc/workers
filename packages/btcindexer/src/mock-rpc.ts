import { WorkerEntrypoint } from "cloudflare:workers";
import type { PutBlocks } from "./api/put-blocks";
import type { TxStatusResp } from "./models";
import { TxStatus } from "./models";
import { Transaction } from "bitcoinjs-lib";

/**
 * Mock RPC entrypoint for btcindexer worker.
 * This is a stateless in-memory mock for local development without external dependencies.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/
 */
export class MockBtcIndexerRpc extends WorkerEntrypoint<Env> {
	// In-memory storage for mock data
	private static blocks = new Map<number, PutBlocks>();
	private static transactions = new Map<string, TxStatusResp>();
	private static nextTxId = 1;

	/**
	 * Store new Bitcoin blocks in the indexer.
	 * @param blocks - Array of blocks to store
	 * @returns Number of blocks inserted
	 */
	async putBlocks(blocks: PutBlocks[]): Promise<number> {
		console.log(`[MOCK] putBlocks called with ${blocks.length} blocks`);
		for (const block of blocks) {
			MockBtcIndexerRpc.blocks.set(block.height, block);
		}
		return blocks.length;
	}

	/**
	 * Get the latest block height stored in the indexer.
	 * @returns Object containing the latest height (or null if no blocks exist)
	 */
	async latestHeight(): Promise<{ height: number | null }> {
		console.log("[MOCK] latestHeight called");
		const heights = Array.from(MockBtcIndexerRpc.blocks.keys());
		const height = heights.length > 0 ? Math.max(...heights) : null;
		return { height };
	}

	/**
	 * Register a broadcasted nBTC transaction.
	 * @param txHex - The transaction hex string
	 * @returns Transaction ID and number of registered deposits
	 */
	async putNbtcTx(txHex: string): Promise<{ tx_id: string; registered_deposits: number }> {
		console.log(`[MOCK] putNbtcTx called with txHex length: ${txHex.length}`);

		try {
			// Parse the transaction to validate it
			const tx = Transaction.fromHex(txHex);
			const txId = tx.getId();

			// Count outputs as mock deposits (in reality, we'd filter for OP_RETURN deposits)
			const registeredDeposits = tx.outs.length;

			// Create a mock transaction status
			const mockStatus: TxStatusResp = {
				btc_tx_id: txId,
				status: TxStatus.BROADCASTING,
				block_height: null,
				confirmations: 0,
				sui_recipient: "0x0000000000000000000000000000000000000000000000000000000000000000",
				amount_sats: tx.outs.reduce((sum, out) => sum + out.value, 0),
				sui_tx_id: null,
			};

			MockBtcIndexerRpc.transactions.set(txId, mockStatus);

			return {
				tx_id: txId,
				registered_deposits: registeredDeposits,
			};
		} catch (error) {
			console.error("[MOCK] Error parsing transaction:", error);
			throw new Error("Invalid transaction hex");
		}
	}

	/**
	 * Get nBTC transaction status by Bitcoin transaction ID.
	 * @param txid - Bitcoin transaction ID
	 * @returns Transaction status or null if not found
	 */
	async statusByTxid(txid: string): Promise<TxStatusResp | null> {
		console.log(`[MOCK] statusByTxid called with txid: ${txid}`);
		return MockBtcIndexerRpc.transactions.get(txid) || null;
	}

	/**
	 * Get all nBTC transactions for a specific Sui address.
	 * @param suiAddress - Sui recipient address
	 * @returns Array of transaction statuses
	 */
	async statusBySuiAddress(suiAddress: string): Promise<TxStatusResp[]> {
		console.log(`[MOCK] statusBySuiAddress called with address: ${suiAddress}`);
		const results: TxStatusResp[] = [];

		for (const tx of MockBtcIndexerRpc.transactions.values()) {
			if (tx.sui_recipient === suiAddress) {
				results.push(tx);
			}
		}

		return results;
	}

	/**
	 * Returns deposit transaction statuses by Bitcoin sender address
	 */
	async depositsBySender(address: string): Promise<TxStatusResp[]> {
		console.log(`[MOCK] depositsBySender called with address: ${address}`);
		// In a real implementation, this would query by sender address
		// For the mock, we'll return an empty array as sender info isn't tracked
		return [];
	}
}
