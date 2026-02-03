export type {
	ConfirmingRedeemReq,
	RedeemRequestEventRaw,
	RedeemRequestResp,
	FinalizeRedeemItem,
} from "./models";

export { RedeemRequestStatus } from "./models";

import type {
	ConfirmingRedeemReq,
	RedeemRequestEventRaw,
	RedeemRequestResp,
	RedeemRequestStatus,
	FinalizeRedeemItem,
} from "./models";

export interface SuiIndexerRpc {
	finalizeRedeems: (requests: FinalizeRedeemItem[]) => Promise<void>;
	putRedeemTx: (setupId: number, suiTxId: string, e: RedeemRequestEventRaw) => Promise<void>;
	getBroadcastedRedeemTxIds: (network: string) => Promise<string[]>;
	confirmRedeem: (txIds: string[], blockHeight: number, blockHash: string) => Promise<void>;
	redeemsBySuiAddr: (setupId: number, suiAddr: string) => Promise<RedeemRequestResp[]>;
	getConfirmingRedeems: (network: string) => Promise<ConfirmingRedeemReq[]>;
	updateRedeemStatus: (redeemId: number, status: RedeemRequestStatus) => Promise<void>;
}
