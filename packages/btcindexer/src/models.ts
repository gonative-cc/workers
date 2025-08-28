import { Transaction } from "bitcoinjs-lib";

export interface Deposit {
	vout: number;
	amountSats: number;
	suiRecipient: string;
}

export interface ProofResult {
	proofPath: Buffer[];
	merkleRoot: string;
}

export interface PendingTx {
	tx_id: string;
	block_hash: string | null;
	block_height: number;
}

export interface FinalizedTxD1Row {
	tx_id: string;
	vout: number;
	block_hash: string;
	block_height: number;
}

export interface GroupedFinalizedTx {
	block_hash: string;
	block_height: number;
	deposits: FinalizedTxD1Row[];
}

export interface Storage {
	d1: D1Database; // SQL DB
	blocksDB: KVNamespace;
	nbtcTxDB: KVNamespace;
}

export type NbtcTxStatus = "confirming" | "finalized" | "minted" | "failed" | "reorg";

export interface NbtcTxStatusResp {
	btc_tx_id: string;
	status: NbtcTxStatus;
	block_height: number | null;
	confirmations: number;
	sui_recipient: string;
	amount_sats: number;
}

export interface NbtcTxD1Row {
	tx_id: string;
	block_hash: string;
	block_height: number | null;
	vout: number;
	sui_recipient: string;
	amount_sats: number;
	status: NbtcTxStatus;
	created_at: number;
	updated_at: number;
}

export interface MintBatchArg {
	tx: Transaction;
	blockHeight: number;
	txIndex: number;
	proof: ProofResult;
}

export interface PostNbtcTxRequest {
	txHex: string;
}
