export interface RedeemProposalReq {
	amount: bigint;
}

export interface RedeemProposalResp {
	// TODO: need to finalize the API and the structure
	utxos: number[];
}
