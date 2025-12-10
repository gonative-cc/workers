import type { Utxo, RedeemRequest } from "@gonative-cc/sui-indexer/models";
import type { Storage } from "./storage";
import type { SuiClient } from "./sui_client";
import { logger, logError } from "@gonative-cc/lib/logger";
import type { SuiNet } from "@gonative-cc/lib/nsui";

export class RedeemService {
	constructor(
		private storage: Storage,
		private clients: Map<SuiNet, SuiClient>,
		private utxoLockTimeMs: number,
	) {
		if (clients.size === 0) {
			throw new Error("No SuiClients configured");
		}
	}

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

	private getSuiClient(suiNet: SuiNet): SuiClient {
		const c = this.clients.get(suiNet);
		if (c === undefined) throw new Error("No SuiClient for the sui network = " + suiNet);
		return c;
	}

	private async processRequest(req: RedeemRequest) {
		logger.info({
			msg: "Processing redeem request",
			redeemId: req.redeem_id,
			amountSats: req.amount_sats.toString(),
		});
		// TODO: we should only fetch it once for all requests. So we fetch it in processPendingRedeems and the pass it to this method
		const availableUtxos = await this.storage.getAvailableUtxos(req.package_id);
		const selectedUtxos = selectUtxos(availableUtxos, req.amount_sats);

		if (!selectedUtxos) {
			logger.warn({
				msg: "Insufficient UTXOs for request",
				redeemId: req.redeem_id,
				neededAmountSats: req.amount_sats.toString(),
			});
			return;
		}

		try {
			const client = this.getSuiClient(req.sui_network);
			const txDigest = await client.proposeRedeemUtxos({
				redeemId: req.redeem_id,
				utxoIds: selectedUtxos.map((u) => u.nbtc_utxo_id),
				dwalletIds: selectedUtxos.map((u) => u.dwallet_id),
				nbtcPkg: req.nbtc_pkg,
				nbtcContract: req.nbtc_contract,
			});

			logger.info({
				msg: "Proposed UTXOs for redeem request",
				redeemId: req.redeem_id,
				txDigest: txDigest,
			});
			await this.storage.markRedeemProposed(
				req.redeem_id,
				selectedUtxos.map((u) => u.nbtc_utxo_id),
				this.utxoLockTimeMs,
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
}

// V1 version
function selectUtxos(available: Utxo[], targetAmount: number): Utxo[] | null {
	let sum = 0;
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
