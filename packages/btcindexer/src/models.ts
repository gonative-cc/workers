import { Transaction } from "bitcoinjs-lib";
import type { SuiNet } from "@gonative-cc/lib/nsui";
import type { BtcNet } from "@gonative-cc/lib/nbtc";

export interface NbtcAddress {
	btc_network: BtcNet;
	sui_network: SuiNet;
	nbtc_pkg: string;
	btc_address: string;
}

export interface Deposit {
	vout: number;
	amountSats: number;
	suiRecipient: string;
	nbtc_pkg: string;
	sui_network: SuiNet;
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
	nbtc_pkg: string;
	sui_network: SuiNet;
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

/**
 * Represents the lifecycle status of an nBTC minting tx.
 * - **broadcasting**: The deposit transaction has been broadcast to the Bitcoin network, but has not yet been included in a block.
 * - **confirming**: The deposit tx has been found in a Bitcoin block but does not yet have enough confirmations.
 * - **finalized**: The tx has reached the required confirmation depth and is ready to be minted.
 * - **minted**: The nBTC has been successfully minted on the SUI network.
 * - **mint-failed**: An attempt to mint a finalized tx failed. Mint should be retried.
 * - **reorg**: A blockchain reorg detected while the tx was in the 'confirming' state. The tx block is no longer part of the canonical chain.
 * - **finalized-reorg**: An edge-case status indicating that a tx was marked 'finalized', but was later discovered to be on an orphaned (re-org deeper than the confirmation depth).
 */
export const enum MintTxStatus {
	Broadcasting = "broadcasting",
	Confirming = "confirming",
	Reorg = "reorg",
	Finalized = "finalized",
	FinalizedReorg = "finalized-reorg",
	Minted = "minted",
	MintFailed = "mint-failed",
}

export const enum BlockStatus {
	New = "new",
	Scanned = "scanned",
}

export interface NbtcTxResp extends Omit<NbtcTxRow, "tx_id"> {
	btc_tx_id: string;
	status: MintTxStatus;
	confirmations: number;
}

export interface NbtcTxRow {
	tx_id: string;
	vout: number;
	// null if tx was detected in mempool
	block_hash: string | null;
	// null if tx was detected in mempool
	block_height: number | null;
	sui_recipient: string;
	amount_sats: number;
	status: MintTxStatus;
	// epoch time in ms
	created_at: number;
	// epoch time in ms
	updated_at: number;
	sui_tx_id: string | null;
	retry_count: number;
	nbtc_pkg: string;
	sui_network: SuiNet;
	btc_network: BtcNet;
}

export interface MintBatchArg {
	tx: Transaction;
	blockHeight: number;
	txIndex: number;
	proof: ProofResult;
	nbtc_pkg: string;
	sui_network: SuiNet;
}

export interface PostNbtcTxRequest {
	txHex: string;
}

export type SuiTxDigest = string;
