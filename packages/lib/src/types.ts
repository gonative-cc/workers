import type { SuiNet } from "./nsui";

export enum UtxoStatus {
	Available = "available",
	Locked = "locked",
	Spent = "spent",
}

export interface Utxo {
	nbtc_utxo_id: string; // utxo_id (u64 index) from MintEvent
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
	Signed = "signed",
	Broadcasted = "broadcasted",
}

export interface RedeemRequest {
	redeem_id: string; // u64
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
	nbtc_utxo_id: string;
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
	redeem_id: string;
	redeemer: string;
	recipient_script: Uint8Array;
	amount_sats: number;
	created_at: number;
	nbtc_pkg: string;
	sui_network: SuiNet;
}

// Arguments for the contract call
export interface ProposeRedeemArgs {
	redeemId: string;
	utxoIds: string[];
	dwalletIds: string[];
	nbtcPkg: string;
	nbtcContract: string;
}
