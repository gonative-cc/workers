export type NbtcTxStatus =
	| "broadcasting"
	| "confirming"
	| "finalized"
	| "minting"
	| "minted"
	| "reorg";

export interface NbtcTx {
	tx_id: string;
	block_hash: string;
	block_height: number;
	vout: number;
	sender_address: string;
	sui_recipient: string;
	amount_sats: number;
	status: NbtcTxStatus;
	created_at: string;
	updated_at: string;
}
