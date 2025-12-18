import type { RedeemRequest, Utxo } from "@gonative-cc/sui-indexer/models";

export type { RedeemRequest, Utxo };

// Arguments for the contract call
export interface ProposeRedeemCall {
	redeemId: string;
	utxoIds: string[];
	dwalletIds: string[];
	nbtcPkg: string;
	nbtcContract: string;
}

export interface SolveRedeemCall {
	redeemId: string;
	nbtcPkg: string;
	nbtcContract: string;
}

export interface RedeemInput {
	id: number;
	redeem_id: string;
	utxo_id: string;
	dwallet_id: string;
	sign_id: string | null;
	created_at: number;
}
