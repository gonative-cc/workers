import { Transaction } from "bitcoinjs-lib";
import { BtcNet, type BlockQueueRecord } from "@gonative-cc/lib/nbtc";
import type { SuiNet } from "@gonative-cc/lib/nsui";

// Base types for composition
export interface NetworkConfig {
	nbtcPkg: string;
	suiNetwork: SuiNet;
}

export interface TxOutput {
	vout: number;
}

export interface DepositAmount {
	amountSats: number;
	suiRecipient: string;
}

export interface BlockLocation {
	blockHash: string;
	blockHeight: number;
}

// Composed interfaces
export interface NbtcAddress {
	btc_network: BtcNet;
	sui_network: SuiNet;
	nbtc_pkg: string;
	btc_address: string;
	is_active: boolean;
}

export interface Deposit extends NetworkConfig, TxOutput, DepositAmount {
	depositAddress: string;
}

export interface ProofResult {
	proofPath: Buffer[];
	merkleRoot: string;
}

export interface PendingTx {
	tx_id: string;
	block_hash: string | null;
	block_height: number;
	btc_network: BtcNet;
	deposit_address: string;
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
	blockHash: string;
	blockHeight: number;
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
 * - **finalized-non-active**: The deposit has been finalized, however the minting will not be attempted because the deposit address is a non-active one. There will be a redemption mechanism for these cases.
 */
export const enum MintTxStatus {
	Broadcasting = "broadcasting",
	Confirming = "confirming",
	Reorg = "reorg",
	Finalized = "finalized",
	FinalizedReorg = "finalized-reorg",
	Minted = "minted",
	MintFailed = "mint-failed",
	FinalizedNonActive = "finalized-non-active",
}

export interface NbtcTxResp extends Omit<NbtcTxRow, "tx_id"> {
	btcTxId: string;
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

export interface MintBatchArg extends NetworkConfig {
	tx: Transaction;
	blockHeight: number;
	txIndex: number;
	proof: ProofResult;
}

export interface PostNbtcTxRequest {
	txHex: string;
	network: BtcNet;
}

export type SuiTxDigest = string;

export type { BlockQueueRecord };

export interface NbtcTxInsertion extends NetworkConfig, TxOutput, DepositAmount, BlockLocation {
	txId: string;
	btcNetwork: BtcNet;
	depositAddress: string;
}

export interface NbtcTxUpdate extends TxOutput {
	txId: string;
	status: MintTxStatus;
	suiTxDigest?: string;
}

export interface NbtcBroadcastedDeposit extends NetworkConfig, TxOutput, DepositAmount {
	txId: string;
	btcNetwork: BtcNet;
	depositAddress: string;
}

export interface ElectrsTxVout {
	scriptpubkey_address?: string;
}

export interface ElectrsTxResponse {
	vout: ElectrsTxVout[];
}
