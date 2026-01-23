import { WorkerEntrypoint } from "cloudflare:workers";
import { logError, logger } from "@gonative-cc/lib/logger";
import { fromBase64 } from "@mysten/sui/utils";

import { D1Storage } from "./storage";
import type { RedeemRequestEventRaw, RedeemRequestResp } from "./models";
import type { SuiIndexerRpc } from "./rpc-interface";

/**
 * RPC entrypoint for the worker.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/
 */
export class RPC extends WorkerEntrypoint<Env> implements SuiIndexerRpc {
	/**
	 * Once BTC withdraw for the Redeem Request is confirmed and finalzed, this method
	 * will update the DB state and remove related UTXOs.
	 */
	async finalizeRedeem(): Promise<void> {
		return;
	}

	async getBroadcastedRedeemTxIds(network: string): Promise<string[]> {
		const storage = new D1Storage(this.env.DB);
		return storage.getBroadcastedBtcRedeemTxIds(network);
	}

	async confirmRedeem(txIds: string[], blockHeight: number, blockHash: string): Promise<void> {
		const storage = new D1Storage(this.env.DB);
		return storage.confirmRedeem(txIds, blockHeight, blockHash);
	}

	/**
	 * Stores a redeem request transaction emitted on Sui into the indexer storage, to be later
	 * tracked by the indexer to trigger solution (UTXOs) proposal in this worker scheduler.
	 *
	 * @param setupId - Identifier of the redeem setup used to fetch network and package metadata.
	 * @param suiTxId - The Sui transaction digest/hash associated with the redeem request.
	 * @param e - The raw redeem request event payload emitted by the Sui indexer.
	 * @returns A promise that resolves when the redeem request has been stored.
	 * @throws {Error} If no setup is found for the given {@link setupId}, or if
	 * the underlying database/indexer storage operations fail.
	 */
	async putRedeemTx(setupId: number, suiTxId: string, e: RedeemRequestEventRaw): Promise<void> {
		try {
			const storage = new D1Storage(this.env.DB);
			if (await storage.hasRedeemRequest(Number(e.redeem_id))) {
				logger.info({
					msg: "Redeem request already processed",
					redeemId: e.redeem_id,
				});
				return;
			}

			const hasInserted = await storage.insertRedeemRequest({
				redeem_id: Number(e.redeem_id),
				redeemer: e.redeemer,
				recipient_script: fromBase64(e.recipient_script),
				amount: Number(e.amount),
				created_at: Number(e.created_at),
				setup_id: setupId,
				sui_tx: suiTxId,
			});
			logger.info({
				msg: `putRedeemTx: Insert Redeem Request event ${
					hasInserted ? "success" : "failed"
				}`,
				id: e.redeem_id,
			});
		} catch (error) {
			logError(
				{
					msg: "Failed to insert Redeem Request event",
					method: "putRedeemTx",
					redeem_id: e.redeem_id,
					redeemer: e.redeemer,
				},
				error,
			);
			throw error;
		}
	}

	async redeemsBySuiAddr(setupId: number, suiAddr: string): Promise<RedeemRequestResp[]> {
		const storage = new D1Storage(this.env.DB);
		return storage.getRedeemsBySuiAddr(setupId, suiAddr);
	}
}
