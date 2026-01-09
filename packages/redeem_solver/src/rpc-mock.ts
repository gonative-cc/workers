import type { RedeemSolverRpc } from "./rpc";
import type { RedeemRequestResp } from "./models";
import type { RedeemRequestEventRaw } from "@gonative-cc/sui-indexer/models";

export class RPCMock implements RedeemSolverRpc {
	async finalizeRedeem() {
		return;
	}

	async redeemsBySuiAddr(suiAddress: string, setupId: number): Promise<RedeemRequestResp[]> {
		return [];
	}

	async putRedeemTx(setupId: number, suiTxId: string, e: RedeemRequestEventRaw): Promise<void> {
		return;
	}
}
