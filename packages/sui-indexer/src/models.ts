import type { SuiNet } from "@gonative-cc/lib/nsui";

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

export enum RedeemRequestStatus {
	Pending = "pending",
	Proposed = "proposed",
	Solved = "solved",
	Signed = "signed",
	Broadcasted = "broadcasted",
}

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
	nbtc_pkg: string;
	sui_network: SuiNet;
	status: UtxoStatus;
	locked_until: number | null;
}

export interface RedeemRequestIngestData {
	redeem_id: number;
	redeemer: string;
	recipient_script: Uint8Array;
	amount: number;
	created_at: number;
	nbtc_pkg: string;
	sui_network: SuiNet;
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
}
