import type { SuiNet } from "@gonative-cc/lib/nsui";
export interface UtxoRecord {
	sui_id: string;
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

export type UtxoStatus = "available" | "locked" | "spent";

export interface RedeemRequestRecord {
	redeem_id: string;
	redeemer: string;
	recipient_script: Uint8Array;
	amount_sats: number;
	created_at: number;
	nbtc_pkg: string;
	sui_network: string;
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

export interface SuiEventNode {
	type: string;
	timestamp: string;
	json: unknown;
}

export interface NetworkConfig {
	name: SuiNet;
	url: string;
}
