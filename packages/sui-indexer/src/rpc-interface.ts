export type { ConfirmingRedeemReq, RedeemRequestEventRaw, RedeemRequestResp } from "./models";

export { RedeemRequestStatus } from "./models";

import type {
	ConfirmingRedeemReq,
	RedeemRequestEventRaw,
	RedeemRequestResp,
	RedeemRequestStatus,
} from "./models";

export interface SuiIndexerRpc {
	finalizeRedeem: (
		redeemId: number,
		proof: string[],
		height: number,
		txIndex: number,
	) => Promise<void>;
	putRedeemTx: (setupId: number, suiTxId: string, e: RedeemRequestEventRaw) => Promise<void>;
	getBroadcastedRedeemTxIds: (network: string) => Promise<string[]>;
	confirmRedeem: (txIds: string[], blockHeight: number, blockHash: string) => Promise<void>;
	redeemsBySuiAddr: (setupId: number, suiAddr: string) => Promise<RedeemRequestResp[]>;
	getConfirmingRedeems: (network: string) => Promise<ConfirmingRedeemReq[]>;
	updateRedeemStatus: (redeemId: number, status: RedeemRequestStatus) => Promise<void>;
}
