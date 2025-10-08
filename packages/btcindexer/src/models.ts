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

export interface FinalizedTxRow {
	tx_id: string;
	vout: number;
	block_hash: string;
	block_height: number;
}

export interface BlockInfo {
	height: number;
	hash: string;
}

export interface GroupedFinalizedTx {
	block_hash: string;
	block_height: number;
	deposits: FinalizedTxRow[];
}

export interface Storage {
	d1: D1Database; // SQL DB
	blocksDB: KVNamespace;
	nbtcTxDB: KVNamespace;
}

/**
 * Represents the lifecycle status of an nBTC minting tx.
 * - **broadcasting**: The deposit transaction has been broadcast to the Bitcoin network, but has not yet been included in a block.
 * - **confirming**: The deposit tx has been found in a Bitcoin block but does not yet have enough confirmations.
 * - **finalized**: The tx has reached the required confirmation depth and is ready to be minted.
 * - **minted**: The nBTC has been successfully minted on the SUI network.
 * - **finalized-failed**: An attempt to mint a finalized tx failed, but it may be retried.
 * - **reorg**: A blockchain reorg detected while the tx was in the 'confirming' state. The tx block is no longer part of the canonical chain.
 * - **finalized-reorg**: An edge-case status indicating that a tx was marked 'finalized', but was later discovered to be on an orphaned (re-org deeper than the confirmation depth).
 */
export const enum TxStatus {
	CONFIRMING = "confirming",
	FINALIZED = "finalized",
	MINTED = "minted",
	FINALIZED_FAILED = "finalized-failed",
	REORG = "reorg",
	FINALIZED_REORG = "finalized-reorg",
	BROADCASTING = "broadcasting",
}

export const enum BlockStatus {
	NEW = "new",
	SCANNED = "scanned",
}

export interface NbtcTxStatusResp {
	btc_tx_id: string;
	status: TxStatus;
	block_height: number | null;
	confirmations: number;
	sui_recipient: string;
	amount_sats: number;
	sui_tx_id: string | null;
}

export interface NbtcTxRow {
	tx_id: string;
	block_hash: string;
	block_height: number | null;
	vout: number;
	sui_recipient: string;
	amount_sats: number;
	status: TxStatus;
	created_at: number;
	updated_at: number;
	sui_tx_id: string | null;
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

export type SuiTxDigest = string;
