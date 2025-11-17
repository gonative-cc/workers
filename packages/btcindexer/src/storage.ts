import { Block } from "bitcoinjs-lib";
import type {
	BlockInfo,
	NbtcTxRow,
	PendingTx,
	MintTxStatus,
	FinalizedTxRow,
	NbtcAddress,
} from "./models";
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
	getConfirmingBlocks(): Promise<{ block_hash: string }[]>;

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

	getNbtcFinalizedTxs(maxRetries: number): Promise<FinalizedTxRow[]>;
	getMintedTxs(): Promise<FinalizedTxRow[]>;
	getTxStatus(txId: string): Promise<MintTxStatus | null>;
	updateNbtcTxsStatus(txIds: string[], status: MintTxStatus): Promise<void>;
	batchUpdateNbtcTxs(
		updates: { tx_id: string; vout: number; status: MintTxStatus; suiTxDigest?: string }[],
	): Promise<void>;
	updateConfirmingTxsToReorg(blockHashes: string[]): Promise<void>;
	getConfirmingTxs(): Promise<PendingTx[]>;
	finalizeNbtcTxs(txIds: string[]): Promise<void>;
	getNbtcMintTx(txid: string): Promise<NbtcTxRow | null>;
	getNbtcMintTxsBySuiAddr(suiAddress: string): Promise<NbtcTxRow[]>;
	registerBroadcastedNbtcTx(
		deposits: { txId: string; vout: number; suiRecipient: string; amountSats: number }[],
	): Promise<void>;
	getNbtcMintTxsByBtcSender(btcAddress: string): Promise<NbtcTxRow[]>;

	// Insert BTC deposit for nBTC mint.
	insertBtcDeposit(senders: { txId: string; sender: string }[]): Promise<void>;
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
