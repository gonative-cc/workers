import { WorkerEntrypoint } from "cloudflare:workers";
import { logError, logger } from "@gonative-cc/lib/logger";
import { fromBase64 } from "@mysten/sui/utils";

import type {
	ConfirmingRedeemReq,
	RedeemRequestEventRaw,
	RedeemRequestResp,
	FinalizeRedeemTx,
} from "@gonative-cc/lib/rpc-types";
import { RedeemRequestStatus } from "@gonative-cc/lib/rpc-types";
import { BtcNet, btcNetFromString } from "@gonative-cc/lib/nbtc";
import type { SuiNet } from "@gonative-cc/lib/nsui";

import { D1Storage } from "./storage";
import type { RedeemRequest } from "./models";
import type { SuiIndexerRpc } from "./rpc-interface";
import { createSuiClients } from "./redeem-sui-client";

/**
 * RPC entrypoint for the worker.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/
 */
export class RPC extends WorkerEntrypoint<Env> implements SuiIndexerRpc {
	private storage(): D1Storage {
		return new D1Storage(this.env.DB, this.env.SETUP_ENV);
	}

	/**
	 * Once BTC withdraw for the Redeem Request is confirmed and finalized, this method
	 * will update the DB state and remove related UTXOs.
	 */
	async finalizeRedeems(requests: FinalizeRedeemTx[]): Promise<void> {
		if (requests.length === 0) return;

		const storage = this.storage();
		const mnemonic = await this.env.NBTC_MINTING_SIGNER_MNEMONIC.get();
		if (!mnemonic) {
			throw new Error("NBTC_MINTING_SIGNER_MNEMONIC not set");
		}

		const { redeemsById, networks } = await this.fetchRedeemDetails(storage, requests);
		if (networks.size === 0) return;

		const clients = await createSuiClients(Array.from(networks), mnemonic);

		for (const req of requests) {
			const details = redeemsById.get(req.redeemId);
			if (!details) continue;

			const client = clients.get(details.sui_network);
			if (!client) {
				logger.error({
					msg: "SuiClient not found for network",
					network: details.sui_network,
					redeemId: req.redeemId,
				});
				continue;
			}

			try {
				const digest = await client.finalizeRedeem({
					redeemId: req.redeemId,
					proof: req.proof,
					height: req.height,
					txIndex: req.txIndex,
					nbtcPkg: details.nbtc_pkg,
					nbtcContract: details.nbtc_contract,
					lcContract: details.lc_contract,
				});

				logger.info({
					msg: "Redeem finalized on Sui",
					redeemId: req.redeemId,
					digest,
				});

				await storage.setRedeemFinalized(req.redeemId);
			} catch (e) {
				logError(
					{
						msg: "Failed to finalize redeem on Sui",
						method: "finalizeRedeems",
						redeemId: req.redeemId,
					},
					e,
				);
			}
		}
	}

	private async fetchRedeemDetails(
		storage: D1Storage,
		requests: FinalizeRedeemTx[],
	): Promise<{ redeemsById: Map<number, RedeemRequest>; networks: Set<SuiNet> }> {
		// maps redeem id -> redeem req
		const redeemsById = new Map<number, RedeemRequest>();
		const networks = new Set<SuiNet>();

		for (const req of requests) {
			try {
				const details = await storage.getRedeem(req.redeemId);
				if (details) {
					redeemsById.set(req.redeemId, details);
					networks.add(details.sui_network);
				} else {
					logger.error({ msg: "Redeem request not found", redeemId: req.redeemId });
				}
			} catch (e) {
				logError(
					{
						msg: "DB error fetching redeem details",
						method: "fetchRedeemDetails",
						redeemId: req.redeemId,
					},
					e,
				);
			}
		}
		return { redeemsById, networks };
	}

	async updateRedeemStatus(redeemId: number, status: RedeemRequestStatus): Promise<void> {
		const storage = this.storage();
		await storage.updateRedeemStatus(redeemId, status);
	}

	async updateRedeemStatuses(redeemIds: number[], status: RedeemRequestStatus): Promise<void> {
		const storage = this.storage();
		await storage.updateRedeemStatuses(redeemIds, status);
	}

	async getConfirmingRedeems(network: string): Promise<ConfirmingRedeemReq[]> {
		const storage = this.storage();
		return storage.getConfirmingRedeems(btcNetFromString(network));
	}

	// TODO: should be by setup_id
	async getBroadcastedRedeemTxIds(btcNet: string): Promise<string[]> {
		return this.storage().getBroadcastedBtcRedeemTxIds(btcNetFromString(btcNet));
	}

	async confirmRedeem(txIds: string[], blockHeight: number, blockHash: string): Promise<void> {
		return this.storage().confirmRedeem(txIds, blockHeight, blockHash);
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
			const storage = this.storage();
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
		return this.storage().getRedeemsBySuiAddr(setupId, suiAddr);
	}
}
