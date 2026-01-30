import { Transaction } from "bitcoinjs-lib";
import { BitcoinTxStatus, BtcNet, type BlockQueueRecord } from "@gonative-cc/lib/nbtc";
import type { NbtcPkg, SuiNet } from "@gonative-cc/lib/nsui";

export interface NbtcDeposit {
	amount: number;
	suiRecipient: string;
}

export interface Block {
	blockHash: string;
	blockHeight: number;
}

export interface Deposit extends NbtcPkg, NbtcDeposit {
	vout: number;
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
	setup_id: number;
	deposit_address: string;
}

export interface FinalizedTxRow {
	tx_id: string;
	vout: number;
	block_hash: string;
	block_height: number;
	setup_id: number;
}

export interface ReorgedMintedTx {
	tx_id: string;
	old_block_hash: string;
	new_block_hash: string;
	block_height: number;
}

export interface BlockInfo {
	height: number;
	hash: string;
}

export interface ConfirmingBlockInfo {
	block_hash: string;
	network: string;
}

/**
 * Represents the lifecycle status of an nBTC minting tx, extending BitcoinTxStatus.
 * - **minted**: The nBTC has been successfully minted on the SUI network.
 * - **mint-failed**: An attempt to mint a finalized tx failed. Mint should be retried.
 * - **minted-reorg**: An edge-case where a tx was successfully minted on Sui, but the Bitcoin deposit was later reorged. Tracked for monitoring purposes for now.
 * - **finalized-non-active**: The deposit has been finalized, however the minting will not be attempted because the deposit address is a non-active one. There will be a redemption mechanism for these cases.
 */
enum MintTxStatusEnum {
	Minted = "minted",
	MintedReorg = "minted-reorg",
	MintFailed = "mint-failed",
	FinalizedNonActive = "finalized-non-active",
}

export type MintTxStatus = MintTxStatusEnum | BitcoinTxStatus;
// NOTE: In case of key conflicts, BitcoinTxStatus takes precedence because it is spread last.
export const MintTxStatus = { ...MintTxStatusEnum, ...BitcoinTxStatus };

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
	amount: number;
	status: MintTxStatus;
	// epoch time in ms
	created_at: number;
	// epoch time in ms
	updated_at: number;
	sui_tx_id: string | null;
	retry_count: number;
	setup_id: number;
}

export interface MintBatchArg extends NbtcPkg {
	tx: Transaction;
	blockHeight: number;
	txIndex: number;
	proof: ProofResult;
	setupId: number;
}

export interface PostNbtcTxRequest {
	txHex: string;
	network: BtcNet;
}

export type SuiTxDigest = string;

export type { BlockQueueRecord };

export interface NbtcTxInsertion extends NbtcPkg, NbtcDeposit, Block {
	txId: string;
	vout: number;
	btcNetwork: BtcNet;
	depositAddress: string;
	sender: string;
}

export interface NbtcTxUpdate {
	txId: string;
	vout: number;
	status: MintTxStatus;
	suiTxDigest?: string;
}

export interface NbtcBroadcastedDeposit extends NbtcPkg, NbtcDeposit {
	txId: string;
	vout: number;
	btcNetwork: BtcNet;
	depositAddress: string;
	sender: string;
}

export interface ElectrsTxVout {
	scriptpubkey_address?: string;
}

export interface ElectrsTxResponse {
	vout: ElectrsTxVout[];
}

export interface NbtcPkgCfg {
	// DB record ID
	id: number;
	btc_network: BtcNet;
	sui_network: SuiNet;
	nbtc_pkg: string;
	nbtc_contract: string;
	lc_pkg: string;
	lc_contract: string;
	nbtc_fallback_addr: string;
	// TODO: this is not needed. We should filter through DB and return only active pkgs.
	is_active: boolean;
}

export interface NbtcDepositAddrVal {
	setup_id: number; // NbtcPkgCfg ID
	is_active: boolean; // flag if the associated bitcoin address is active
}

// Maps Bitcoin deposit address to NbtcDepositAddrMapping
export type NbtcDepositAddrsMap = Map<string, NbtcDepositAddrVal>;

export interface ProcessedKey {
	tx_id: string;
	vout: number;
}

export interface PreparedMintBatches {
	batches: Map<
		number,
		{
			mintArgs: MintBatchArg[];
			processedKeys: ProcessedKey[];
		}
	>;
}

export const enum InsertBlockStatus {
	Inserted = "inserted",
	Updated = "updated",
	Skipped = "skipped",
}

export type InsertBlockResult = InsertBlockStatus;
