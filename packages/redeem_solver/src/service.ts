import type { Utxo, RedeemRequest } from "@gonative-cc/lib/types";
import type { Storage } from "./storage";
import { SuiClientImp } from "./sui_client";

export class RedeemService {
	constructor(
		private storage: Storage,
		private signerMnemonic: string,
	) {}

	async processPendingRedeems() {
		const pendingRequests = await this.storage.getPendingRedeems();
		if (pendingRequests.length === 0) {
			console.log("No pending redeem requests.");
			return;
		}

		for (const req of pendingRequests) {
			await this.processRequest(req);
		}
	}

	private async processRequest(req: RedeemRequest) {
		console.log(`Processing redeem request: ${req.redeem_id} for ${req.amount_sats} sats`);
		const availableUtxos = await this.storage.getAvailableUtxos(req.package_id);
		const selectedUtxos = this.selectUtxos(availableUtxos, req.amount_sats);

		if (!selectedUtxos) {
			console.warn(
				`Insufficient UTXOs for request ${req.redeem_id}. Needed: ${req.amount_sats}`,
			);
			return;
		}

		try {
			const client = new SuiClientImp({
				network: req.sui_network,
				signerMnemonic: this.signerMnemonic,
			});

			const txDigest = await client.proposeRedeemUtxos({
				redeemId: req.redeem_id,
				utxoIds: selectedUtxos.map((u) => u.sui_id),
				dwalletIds: selectedUtxos.map((u) => u.dwallet_id),
				nbtcPkg: req.nbtc_pkg,
				nbtcContract: req.nbtc_contract,
			});

			console.log(`Proposed UTXOs for ${req.redeem_id}. Digest: ${txDigest}`);
			await this.storage.markRedeemResolving(
				req.redeem_id,
				selectedUtxos.map((u) => u.sui_id),
			);
		} catch (e) {
			console.error(`Failed to propose UTXOs for ${req.redeem_id}:`, e);
		}
	}

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
