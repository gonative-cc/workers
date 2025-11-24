export interface UtxoRecord {
	sui_id: string;
	txid: string;
	vout: number;
	amount_sats: number;
	script_pubkey: Uint8Array;
	nbtc_pkg: string;
	sui_network: string;
	status: "available" | "locked" | "spent";
}

// Matches the new Move Event structure
export interface MintEventRaw {
	btc_tx_id: number[];
	utxo_idx: string; // TODO: check if we should store u64 as number or string
	btc_vout: number;
	bitcoin_spend_key: number[];
	amount: string;
}

export interface MintEventNode {
	json: MintEventRaw;
	cursor: string;
	timestamp: number;
}

export interface NetworkConfig {
	name: string;
	url: string;
}
