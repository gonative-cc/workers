import type {
	NbtcTxRow,
	PendingTx,
	MintTxStatus,
	FinalizedTxRow,
	NbtcAddress,
	NbtcTxInsertion,
	NbtcTxUpdate,
	NbtcBroadcastedDeposit,
	UtxoRecord,
	UtxoKey,
} from "./models";
import { D1Database } from "@cloudflare/workers-types";
import type { BlockQueueRecord } from "@gonative-cc/lib/nbtc";

export interface Storage {
	// Block operations
	insertBlockInfo(blockMessage: BlockQueueRecord): Promise<boolean>;
	updateBlockStatus(hash: string, network: string, status: string): Promise<void>;
	getLatestBlockHeight(): Promise<number | null>;
	getChainTip(): Promise<number | null>;
	setChainTip(height: number): Promise<void>;
	getBlock(hash: string): Promise<ArrayBuffer | null>;
	getBlockHash(height: number, network: string): Promise<string | null>;
	getConfirmingBlocks(): Promise<{ block_hash: string }[]>;

	// nBTC Transaction operations
	insertOrUpdateNbtcTxs(txs: NbtcTxInsertion[]): Promise<void>;
	getNbtcFinalizedTxs(maxRetries: number): Promise<FinalizedTxRow[]>;
	updateNbtcTxsStatus(txIds: string[], status: MintTxStatus): Promise<void>;
	batchUpdateNbtcTxs(updates: NbtcTxUpdate[]): Promise<void>;
	updateConfirmingTxsToReorg(blockHashes: string[]): Promise<void>;
	getConfirmingTxs(): Promise<PendingTx[]>;
	finalizeNbtcTxs(txIds: string[]): Promise<void>;
	getNbtcMintTx(txid: string): Promise<NbtcTxRow | null>;
	getNbtcMintTxsBySuiAddr(suiAddress: string): Promise<NbtcTxRow[]>;
	registerBroadcastedNbtcTx(deposits: NbtcBroadcastedDeposit[]): Promise<void>;
	getNbtcMintTxsByBtcSender(btcAddress: string): Promise<NbtcTxRow[]>;
	insertNbtcMintDeposit(senders: NbtcDepositSender[]): Promise<void>;

	// UTXO operations
	insertUtxos(utxos: UtxoRecord[]): Promise<void>;
	markUtxosAsSpent(spends: UtxoKey[], spentInBlockHash: string): Promise<void>;
	unspendUtxosByBlockHash(blockHash: string): Promise<void>;
	deleteUtxosByBlockHash(blockHash: string): Promise<void>;
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

export interface NbtcDepositSender {
	tx_id: string;
	sender: string;
}
