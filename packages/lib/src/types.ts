import type { SuiNet } from "./nsui";

export type UtxoStatus = "available" | "locked" | "spent";

export interface Utxo {
	sui_id: string;
	dwallet_id: string;
	txid: string;
	vout: number;
	amount_sats: bigint;
	script_pubkey: Uint8Array;
	address_id: number;
	status: UtxoStatus;
	locked_until: number | null;
}

export interface RedeemRequest {
	redeem_id: string; // u64
	package_id: number;
	redeemer: string;
	recipient_script: Uint8Array;
	amount_sats: bigint;
	status: string;
	created_at: number;
	nbtc_pkg: string;
	nbtc_contract: string;
	sui_network: SuiNet;
}

export interface UtxoIngestData {
	sui_id: string;
	dwallet_id: string;
	txid: string;
	vout: number;
	amount_sats: bigint;
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
	amount_sats: bigint;
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
