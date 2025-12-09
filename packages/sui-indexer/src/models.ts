import type { SuiNet } from "@gonative-cc/lib/nsui";
export type {
	Utxo,
	RedeemRequest,
	UtxoIngestData,
	RedeemRequestIngestData,
	UtxoStatus,
} from "@gonative-cc/lib/types";

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
