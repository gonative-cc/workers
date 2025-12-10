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

export interface RedeemProposalResp {
	utxos: number[];
}
