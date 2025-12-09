import type { Utxo, RedeemRequest } from "@gonative-cc/lib/types";
import type { Storage } from "./storage";
import type { SuiClient } from "./sui_client";
import { logger, logError } from "@gonative-cc/lib/logger";
import type { SuiNet } from "@gonative-cc/lib/nsui";

export class RedeemService {
	constructor(
		private storage: Storage,
		private clients: Map<SuiNet, SuiClient>,
	) {}

	async processPendingRedeems() {
		const pendingRequests = await this.storage.getPendingRedeems();
		if (pendingRequests.length === 0) {
			logger.info({ msg: "No pending redeem requests" });
			return;
		}

		for (const req of pendingRequests) {
			await this.processRequest(req);
		}
	}

	private async processRequest(req: RedeemRequest) {
		logger.info({
			msg: "Processing redeem request",
			redeemId: req.redeem_id,
			amountSats: req.amount_sats.toString(),
		});
		const availableUtxos = await this.storage.getAvailableUtxos(req.package_id);
		const selectedUtxos = this.selectUtxos(availableUtxos, req.amount_sats);

		if (!selectedUtxos) {
			logger.warn({
				msg: "Insufficient UTXOs for request",
				redeemId: req.redeem_id,
				neededAmountSats: req.amount_sats.toString(),
			});
			return;
		}

		const client = this.clients.get(req.sui_network);
		if (!client) {
			logger.error({
				msg: "No SuiClient configured for network",
				network: req.sui_network,
				redeemId: req.redeem_id,
			});
			return;
		}

		try {
			const txDigest = await client.proposeRedeemUtxos({
				redeemId: req.redeem_id,
				utxoIds: selectedUtxos.map((u) => u.sui_id),
				dwalletIds: selectedUtxos.map((u) => u.dwallet_id),
				nbtcPkg: req.nbtc_pkg,
				nbtcContract: req.nbtc_contract,
			});

			logger.info({
				msg: "Proposed UTXOs for redeem request",
				redeemId: req.redeem_id,
				txDigest: txDigest,
			});
			await this.storage.markRedeemResolving(
				req.redeem_id,
				selectedUtxos.map((u) => u.sui_id),
			);
		} catch (e: unknown) {
			logError(
				{
					msg: "Failed to propose UTXOs for redeem request",
					method: "processRequest",
					redeemId: req.redeem_id,
				},
				e,
			);
		}
	}
	// V1 version
	private selectUtxos(available: Utxo[], targetAmount: bigint): Utxo[] | null {
		let sum = 0n;
		const selected: Utxo[] = [];

		for (const utxo of available) {
			sum += utxo.amount_sats;
			selected.push(utxo);
			if (sum >= targetAmount) {
				return selected;
			}
		}

		return null;
	}
}
