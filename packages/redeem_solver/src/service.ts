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
		private redeemDurationMs: number,
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

	async solveReadyRedeems() {
		const maxCreatedAt = Date.now() - this.redeemDurationMs;
		const readyRedeemRequests = await this.storage.getRedeemsReadyForSolving(maxCreatedAt);
		if (readyRedeemRequests.length === 0) {
			return;
		}

		for (const req of readyRedeemRequests) {
			await this.solveRequest(req);
		}
	}

	async signSolvedRedeems() {
		const solved = await this.storage.getSolvedRedeems();
		if (solved.length === 0) return;

		for (const req of solved) {
			for (let i = 0; i < req.inputs.length; i++) {
				const input = req.inputs[i];
				if (!input || input.sign_id) continue;

				try {
					logger.info({
						msg: "Requesting signature for input",
						redeemId: req.redeem_id,
						utxoId: input.utxo_id,
						inputIdx: i,
					});

					const client = this.getSuiClient(req.sui_network);

					const message = await client.getSigHash(
						req.redeem_id,
						i,
						req.nbtc_pkg,
						req.nbtc_contract,
					);

					const presignId = await client.requestGlobalPresign();
					const { cap_id } = await client.createUserSigCap(
						input.dwallet_id,
						presignId,
						message,
					);

					const signId = await client.requestInputSignature(
						req.redeem_id,
						i,
						cap_id,
						req.nbtc_pkg,
						req.nbtc_contract,
					);

					await this.storage.updateInputSignature(req.redeem_id, input.utxo_id, signId);

					logger.info({
						msg: "Requested signature",
						redeemId: req.redeem_id,
						utxoId: input.utxo_id,
						signId: signId,
					});
				} catch (e) {
					logError(
						{
							msg: "Failed to request signature",
							method: "signSolvedRedeems",
							redeemId: req.redeem_id,
							utxoId: input.utxo_id,
						},
						e,
					);
				}
			}
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

	private async solveRequest(req: RedeemRequest) {
		logger.info({
			msg: "Finalizing redeem request",
			redeemId: req.redeem_id,
		});

		try {
			const client = this.getSuiClient(req.sui_network);
			// NOTE: we are not using a PBT here to avoid problems when someone frontruns this call
			const txDigest = await client.solveRedeemRequest({
				redeemId: req.redeem_id,
				nbtcPkg: req.nbtc_pkg,
				nbtcContract: req.nbtc_contract,
			});

			logger.info({
				msg: "Solved redeem request",
				redeemId: req.redeem_id,
				txDigest: txDigest,
			});

			await this.storage.markRedeemSolved(req.redeem_id);
		} catch (e: unknown) {
			logError(
				{
					msg: "Failed to solve redeem request",
					method: "solveRequest",
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
