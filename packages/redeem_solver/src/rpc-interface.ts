import type { RedeemRequestResp } from "./models";
import { type RedeemRequestEventRaw } from "@gonative-cc/sui-indexer/models";

export interface RedeemSolverRpcI {
	proposeRedeemUtxos(): Promise<void>;
	redeemsBySuiAddr(suiAddress: string, setupId: number): Promise<RedeemRequestResp[]>;
	putRedeemTx(setupId: number, suiTxId: string, e: RedeemRequestEventRaw): Promise<void>;
}
