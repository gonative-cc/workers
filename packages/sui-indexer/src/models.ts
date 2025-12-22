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
	amount_sats: number;
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
	redeem_id: number; // u64
	package_id: number;
	redeemer: string;
	recipient_script: Uint8Array;
	amount_sats: number;
	status: RedeemRequestStatus;
	created_at: number;
	nbtc_pkg: string;
	nbtc_contract: string;
	sui_network: SuiNet;
}

export interface UtxoIngestData {
	nbtc_utxo_id: number;
	dwallet_id: string;
	txid: string;
	vout: number;
	amount_sats: number;
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
	amount_sats: number;
	created_at: number;
	nbtc_pkg: string;
	sui_network: SuiNet;
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
}

export interface NetworkConfig {
	name: SuiNet;
	url: string;
}
