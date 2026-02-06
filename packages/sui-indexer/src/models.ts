import type { SuiNet } from "@gonative-cc/lib/nsui";
import {
	type RedeemRequestResp,
	type ConfirmingRedeemReq,
	RedeemRequestStatus,
	type FinalizeRedeemTx,
} from "@gonative-cc/lib/rpc-types";

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
	lc_pkg: string;
	lc_contract: string;
	sui_network: SuiNet;
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

// partial entry in the setups table
export interface NbtcPkg {
	setup_id: number;
	nbtc_pkg: string;
}

// Arguments for the contract call
export interface ProposeRedeemCall {
	redeemId: number;
	utxoIds: number[];
	nbtcPkg: string;
	nbtcContract: string;
}

export interface SolveRedeemCall {
	redeemId: number;
	nbtcPkg: string;
	nbtcContract: string;
}

export interface FinalizeRedeemCall {
	redeemId: number;
	proof: string[]; // hex encoded
	height: number;
	txIndex: number;
	nbtcPkg: string;
	nbtcContract: string;
	lcContract: string;
}
