import { WorkerEntrypoint } from "cloudflare:workers";

import type { RedeemSolverRpc } from "./redeem-rpc";
import type { RedeemRequestResp } from "./models";
import { RedeemRequestStatus, type RedeemRequestEventRaw } from "./models";

export class RPCMock extends WorkerEntrypoint<Env> implements RedeemSolverRpc {
	// map setup_id -> redeemer (sui addr) -> redeem req
	redeemRequests: Record<number, Record<string, RedeemRequestResp[]>> = {};

	async finalizeRedeem() {
		return;
	}

	async getBroadcastedRedeemTxIds(): Promise<string[]> {
		return [];
	}

	async confirmRedeem(_txIds: string[], _blockHeight: number, _blockHash: string): Promise<void> {
		return;
	}

	async putRedeemTx(setupId: number, suiTxId: string, e: RedeemRequestEventRaw): Promise<void> {
		const r: RedeemRequestResp = {
			redeem_id: Number(e.redeem_id),
			recipient_script: e.recipient_script,
			amount: Number(e.amount),
			created_at: Number(e.created_at),
			status: RedeemRequestStatus.Pending,
			sui_tx: suiTxId,
			btc_tx: null,
			confirmations: 0,
		};
		let bySetup = this.redeemRequests[setupId];
		if (bySetup === undefined) {
			bySetup = {};
			bySetup[e.redeemer] = [r];
			this.redeemRequests[setupId] = bySetup;
		} else {
			let txs = bySetup[e.redeemer];
			if (txs === undefined) txs = [r];
			else txs.push(r);
		}
	}
}
