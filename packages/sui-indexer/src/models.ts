import type { SuiNet } from "@gonative-cc/lib/nsui";
import { BitcoinTxStatus } from "@gonative-cc/lib/nbtc";

export enum UtxoStatus {
	Available = "available",
	Locked = "locked",
	Spent = "spent",
}

export interface Utxo {
	nbtc_utxo_id: number; // utxo_id (u64 index) from MintEvent
	dwallet_id: string;
	txid: string;
	vout: number;
	amount: number;
	script_pubkey: Uint8Array;
	address_id: number;
	status: UtxoStatus;
	locked_until: number | null;
}

export enum RedeemStatusEnum {
	Pending = "pending",
	Proposed = "proposed",
	Solved = "solved",
	Signed = "signed",
}

export type RedeemRequestStatus = RedeemStatusEnum | BitcoinTxStatus;
// NOTE: In case of key conflicts, BitcoinTxStatus takes precedence because it is spread last.
export const RedeemRequestStatus = { ...RedeemStatusEnum, ...BitcoinTxStatus };

export interface RedeemRequest {
	redeem_id: number; // redeem ID created by the smart contract index (u64)
	setup_id: number;
	redeemer: string;
	recipient_script: Uint8Array;
	amount: number;
	status: RedeemRequestStatus;
	created_at: number;
	nbtc_pkg: string;
	nbtc_contract: string;
	sui_network: SuiNet;
}

// response interface for redeem requests rpc
export interface RedeemRequestResp {
	redeem_id: number;
	recipient_script: string;
	amount: number;
	status: RedeemRequestStatus;
	created_at: number;
	sui_tx: string; // sui tx initiating the redeem process
	btc_tx: string | null; // null if not broadcasted
	confirmations: number; // 0 if not broadcasted
}

export interface UtxoIngestData {
	nbtc_utxo_id: number;
	dwallet_id: string;
	txid: string;
	vout: number;
	amount: number;
	script_pubkey: Uint8Array;
	setup_id: number;
	status: UtxoStatus;
	locked_until: number | null;
}

export interface RedeemRequestIngestData {
	redeem_id: number;
	redeemer: string;
	recipient_script: Uint8Array;
	amount: number;
	created_at: number;
	setup_id: number;
	sui_tx: string;
}

// Raw Event Interfaces (Matches Move Events)
export interface MintEventRaw {
	recipient: string;
	fee: string;
	dwallet_id: string;
	utxo_id: string;
	btc_script_publickey: string;
	btc_tx_id: string;
	btc_vout: number; // u32
	btc_amount: string;
}

export interface RedeemRequestEventRaw {
	redeem_id: string;
	redeemer: string;
	recipient_script: string;
	amount: string;
	created_at: string;
}

export interface ProposeUtxoEventRaw {
	redeem_id: string;
	dwallet_ids: string[];
	utxo_ids: string[];
}

export interface SolvedEventRaw {
	redeem_id: string;
	utxo_ids: string[];
	dwallet_ids: string[];
}

export interface SignatureRecordedEventRaw {
	redeem_id: string;
	utxo_id: string;
	sign_id: string;
}

export interface SuiEventNode {
	type: string;
	timestamp: string;
	json: unknown;
	txDigest: string;
}

export interface NetworkConfig {
	name: SuiNet;
	url: string;
}

// partial entry in the setups table
export interface PkgCfg {
	id: number;
	nbtc_pkg: string;
	coordinator_pkg?: string; // dWallet coordinator package
}

// Ika coordinator event interfaces
export interface IkaCompletedSignEventRaw {
	sign_id: string;
	signature: number[]; // vector<u8>
	is_future_sign: boolean;
}

export interface IkaRejectedSignEventRaw {
	sign_id: string;
	is_future_sign: boolean;
}

// Arguments for the contract call
export interface ProposeRedeemCall {
	redeemId: number;
	utxoIds: number[];
	dwalletIds: string[];
	nbtcPkg: string;
	nbtcContract: string;
}

export interface SolveRedeemCall {
	redeemId: number;
	nbtcPkg: string;
	nbtcContract: string;
}
