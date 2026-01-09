import { WorkerEntrypoint } from "cloudflare:workers";
import { D1Storage } from "./storage";
import type { RedeemRequestResp } from "./models";
import { type RedeemRequestEventRaw } from "@gonative-cc/sui-indexer/models";
import { logError, logger } from "@gonative-cc/lib/logger";
import { fromBase64 } from "@mysten/sui/utils";
import type { SuiNet } from "@gonative-cc/lib/nsui";

/**
 * RPC entrypoint for the worker.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/
 */
export class RPC extends WorkerEntrypoint<Env> {
	/**
	 * Based on tx result, it shoud lock the UTXOs and mark them as spent
	 * TODO (in the future): we need to observe which UTXOs has been spent because maybe
	 * someone else proposes a better one.
	 */
	async proposeRedeemUtxos(): Promise<void> {
		return;
	}

	async redeemsBySuiAddr(suiAddress: string, setupId: number): Promise<RedeemRequestResp[]> {
		const storage = new D1Storage(this.env.DB);
		return storage.getRedeemsBySuiAddr(suiAddress, setupId);
	}

	/**
	 * Stores a redeem request transaction emitted on Sui into the indexer storage.
	 *
	 * This method looks up the redeem setup by its identifier to determine the
	 * Sui network and NBTC package, then persists the redeem request event
	 * details (including the Sui transaction ID) for later processing.
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

			const redeemRow = await this.env.DB.prepare(
				"SELECT * FROM nbtc_redeem_requests WHERE redeem_id = ?",
			)
				.bind(e.redeem_id)
				.first();

			if (redeemRow) {
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

	async notifyRedeemsConfirmed(
		txIds: string[],
		blockHeight: number,
		blockHash: string,
	): Promise<void> {
		const storage = new D1Storage(this.env.DB);
		await storage.confirmRedeem(txIds, blockHeight, blockHash);
	}
}
