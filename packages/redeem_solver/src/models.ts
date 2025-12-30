import type { RedeemRequestResp, RedeemRequest, Utxo } from "@gonative-cc/sui-indexer/models";

export type { RedeemRequestResp, Utxo };

// Arguments for the contract call
export interface ProposeRedeemCall {
	redeemId: number;
	utxoIds: number[];
	dwalletIds: string[];
	nbtcPkg: string;
	nbtcContract: string;
}

export interface SolveRedeemCall {
	redeemId: number;
	nbtcPkg: string;
	nbtcContract: string;
}

export interface RedeemInput {
	redeem_id: number;
	utxo_id: number;
	input_index: number;
	dwallet_id: string;
	sign_id: string | null;
	verified: boolean;
	created_at: number;
}

export interface RedeemRequestWithInputs extends RedeemRequest {
	inputs: RedeemInput[];
}
