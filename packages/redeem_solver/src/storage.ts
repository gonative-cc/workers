import type { RedeemRequest, Utxo, UtxoStatus } from "@gonative-cc/lib/types";
import { toSuiNet, type SuiNet } from "@gonative-cc/lib/nsui";

interface RedeemRequestRow {
	redeem_id: string;
	package_id: number;
	redeemer: string;
	recipient_script: ArrayBuffer;
	amount_sats: number;
	status: string;
	created_at: number;
	nbtc_pkg: string;
	nbtc_contract: string;
	sui_network: string;
}

interface UtxoRow {
	sui_id: string;
	dwallet_id: string;
	txid: string;
	vout: number;
	amount_sats: number;
	script_pubkey: ArrayBuffer;
	address_id: number;
	status: UtxoStatus;
	locked_until: number | null;
}

export interface Storage {
	getPendingRedeems(): Promise<RedeemRequest[]>;
	getAvailableUtxos(packageId: number): Promise<Utxo[]>;
	markRedeemResolving(redeemId: string, utxoIds: string[]): Promise<void>;
	getActiveNetworks(): Promise<SuiNet[]>;
}

export class D1Storage implements Storage {
	constructor(private db: D1Database) {}

	async getPendingRedeems(): Promise<RedeemRequest[]> {
		const query = `
            SELECT
                r.redeem_id, r.package_id, r.redeemer, r.recipient_script, r.amount_sats, r.status, r.created_at,
                p.nbtc_pkg, p.nbtc_contract, p.sui_network
            FROM nbtc_redeem_requests r
            JOIN nbtc_packages p ON r.package_id = p.id
            WHERE r.status = 'pending'
            ORDER BY r.created_at ASC
            LIMIT 50;
        `;
		const { results } = await this.db.prepare(query).all<RedeemRequestRow>();

		return results.map((r) => ({
			...r,
			amount_sats: r.amount_sats,
			recipient_script: new Uint8Array(r.recipient_script),
			sui_network: toSuiNet(r.sui_network),
		}));
	}

	async getAvailableUtxos(packageId: number): Promise<Utxo[]> {
		const query = `
			SELECT u.sui_id, u.dwallet_id, u.txid, u.vout, u.amount_sats, u.script_pubkey, u.address_id, u.status, u.locked_until
			FROM nbtc_utxos u
			JOIN nbtc_deposit_addresses a ON u.address_id = a.id
			WHERE a.package_id = ?
			AND u.status = 'available'
			ORDER BY u.amount_sats DESC;
		`;
		const { results } = await this.db.prepare(query).bind(packageId).all<UtxoRow>();

		return results.map((u) => ({
			...u,
			amount_sats: u.amount_sats,
			script_pubkey: new Uint8Array(u.script_pubkey),
		}));
	}

	async markRedeemResolving(redeemId: string, utxoIds: string[]): Promise<void> {
		const batch = [];
		batch.push(
			this.db
				.prepare("UPDATE nbtc_redeem_requests SET status = 'resolving' WHERE redeem_id = ?")
				.bind(redeemId),
		);
		const lockUntil = Date.now() + 1000 * 60 * 60; // 1 Hour
		for (const id of utxoIds) {
			batch.push(
				this.db
					.prepare(
						"UPDATE nbtc_utxos SET status = 'locked', locked_until = ? WHERE sui_id = ?",
					)
					.bind(lockUntil, id),
			);
		}
		await this.db.batch(batch);
	}

	async getActiveNetworks(): Promise<SuiNet[]> {
		const result = await this.db
			.prepare("SELECT DISTINCT sui_network FROM nbtc_packages WHERE is_active = 1")
			.all<{ sui_network: string }>();

		return result.results.map((r) => toSuiNet(r.sui_network));
	}
}
