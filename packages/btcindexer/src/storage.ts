import { Block } from "bitcoinjs-lib";
import type { BlockInfo, NbtcTxRow, PendingTx, FinalizedTxRow, NbtcAddress } from "./models";
import { TxStatus } from "./models";
import { D1Database } from "@cloudflare/workers-types";

export interface Storage {
	// Block operations
	putBlocks(blocks: { height: number; block: Block }[]): Promise<void>;
	getBlocksToProcess(batchSize: number): Promise<BlockInfo[]>;
	updateBlockStatus(heights: number[], status: string): Promise<void>;
	getLatestBlockHeight(): Promise<number | null>;
	getChainTip(): Promise<number | null>;
	setChainTip(height: number): Promise<void>;
	getBlock(hash: string): Promise<ArrayBuffer | null>;
	getBlockInfo(height: number): Promise<{ hash: string } | null>;

	// nBTC Transaction operations
	insertOrUpdateNbtcTxs(
		txs: {
			txId: string;
			vout: number;
			blockHash: string;
			blockHeight: number;
			suiRecipient: string;
			amountSats: number;
			nbtc_pkg: string;
			sui_network: string;
		}[],
	): Promise<void>;
	getFinalizedTxs(maxRetries: number): Promise<FinalizedTxRow[]>;
	updateTxsStatus(txIds: string[], status: TxStatus): Promise<void>;
	batchUpdateNbtcTxs(
		updates: { tx_id: string; vout: number; status: TxStatus; suiTxDigest?: string }[],
	): Promise<void>;
	getConfirmingBlocks(): Promise<{ block_hash: string }[]>;
	updateConfirmingTxsToReorg(blockHashes: string[]): Promise<void>;
	getConfirmingTxs(): Promise<PendingTx[]>;
	finalizeTxs(txIds: string[]): Promise<void>;
	getStatusByTxid(txid: string): Promise<NbtcTxRow | null>;
	getStatusBySuiAddress(suiAddress: string): Promise<NbtcTxRow[]>;
	registerBroadcastedNbtcTx(
		deposits: { txId: string; vout: number; suiRecipient: string; amountSats: number }[],
	): Promise<void>;
	getDepositsBySender(btcAddress: string): Promise<NbtcTxRow[]>;

	// Sender operations
	insertSenderDeposits(senders: { txId: string; sender: string }[]): Promise<void>;
}

/**
 * Fetches all nBTC deposit addresses from the D1 database.
 * @param db The D1 database binding.
 * @returns A promise that resolves to an array of NbtcAddress objects.
 */
export async function fetchNbtcAddresses(db: D1Database): Promise<NbtcAddress[]> {
	const { results } = await db.prepare("SELECT * FROM nbtc_addresses").all<NbtcAddress>();
	return results || [];
}
