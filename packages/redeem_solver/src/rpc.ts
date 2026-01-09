import { WorkerEntrypoint } from "cloudflare:workers";
import { D1Storage } from "./storage";
import type { RedeemRequestResp } from "./models";
import type { RedeemRequestEventRaw } from "@gonative-cc/sui-indexer/models";
import { IndexerStorage } from "@gonative-cc/sui-indexer/storage";
import { logError, logger } from "@gonative-cc/lib/logger";
import { fromBase64 } from "@mysten/sui/utils";
import type { SuiNet } from "@gonative-cc/lib/nsui";

export interface RedeemSolverRpc {
	finalizeRedeem: () => Promise<void>;
	redeemsBySuiAddr: (suiAddress: string, setupId: number) => Promise<RedeemRequestResp[]>;
	putRedeemTx: (setupId: number, suiTxId: string, e: RedeemRequestEventRaw) => Promise<void>;
}

/**
 * RPC entrypoint for the worker.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/
 */
export class RPC extends WorkerEntrypoint<Env> implements RedeemSolverRpc {
	/**
	 * Once BTC withdraw for the Redeem Request is confirmed and finalzed, this method
	 * will update the DB state and remove related UTXOs.
	 */
	async finalizeRedeem(): Promise<void> {
		return;
	}

	async redeemsBySuiAddr(suiAddress: string, setupId: number): Promise<RedeemRequestResp[]> {
		const storage = new D1Storage(this.env.DB);
		return storage.getRedeemsBySuiAddr(suiAddress, setupId);
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
			const setupRow = await this.env.DB.prepare(
				"SELECT sui_network, nbtc_pkg FROM setups WHERE id = ?",
			)
				.bind(setupId)
				.first<{ sui_network: SuiNet; nbtc_pkg: string }>();

			if (!setupRow) {
				throw new Error(`No setup found with id: ${setupId}`);
			}

			const ok = await this.env.DB.prepare(
				"SELECT 1 FROM nbtc_redeem_requests WHERE redeem_id = ?",
			)
				.bind(e.redeem_id)
				.first();

			if (ok) {
				logger.info({ msg: `Redeem id: ${e.redeem_id} already exists in the table` });
				return;
			}

			const hasInserted = await storage.insertRedeemRequest({
				redeem_id: Number(e.redeem_id),
				redeemer: e.redeemer,
				recipient_script: fromBase64(e.recipient_script),
				amount: Number(e.amount),
				created_at: Number(e.created_at),
				nbtc_pkg: setupRow.nbtc_pkg,
				sui_network: setupRow.sui_network,
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
}
