import type { RedeemRequestEventRaw, RedeemRequestResp } from "./models";

export interface SuiIndexerRpc {
	finalizeRedeem: () => Promise<void>;
	putRedeemTx: (setupId: number, suiTxId: string, e: RedeemRequestEventRaw) => Promise<void>;
	getBroadcastedRedeemTxIds: (network: string) => Promise<string[]>;
	confirmRedeem: (txIds: string[], blockHeight: number, blockHash: string) => Promise<void>;
	redeemsBySuiAddr: (setupId: number, suiAddr: string) => Promise<RedeemRequestResp[]>;
}
