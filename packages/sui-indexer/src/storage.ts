import { logError, logger } from "@gonative-cc/lib/logger";
import type { RedeemRequestRecord, UtxoRecord } from "./models";
import type { SuiNet } from "@gonative-cc/lib/nsui";

export class IndexerStorage {
	constructor(private db: D1Database) {}

	// returns the latest cursor position for querying Sui events.
	async getSuiGqlCursor(packageId: string): Promise<string | null> {
		const res = await this.db
			.prepare("SELECT value FROM indexer_state WHERE key = ?")
			.bind(packageId)
			.first<{ value: string }>();
		return res?.value || null;
	}

	// Saves the cursor position for querying Sui events.
	async saveSuiGqlCursor(packageId: string, cursor: string): Promise<void> {
		await this.db
			.prepare(
				`INSERT INTO indexer_state (key, value, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
			)
			.bind(packageId, cursor, Date.now())
			.run();
	}

	async insertUtxo(u: UtxoRecord): Promise<void> {
		const stmt = this.db.prepare(
			`INSERT OR REPLACE INTO nbtc_utxos
            (sui_id dwallet_id, txid, vout, amount_sats, script_pubkey, nbtc_pkg, sui_network, status, locked_until)
            VALUES (?,? ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		try {
			await stmt
				.bind(
					u.sui_id,
					u.dwallet_id,
					u.txid,
					u.vout,
					u.amount_sats,
					u.script_pubkey,
					u.nbtc_pkg,
					u.sui_network,
					u.status,
					u.locked_until,
				)
				.run();
		} catch (error) {
			logError(
				{
					msg: "Failed to insert UTXO",
					method: "insertUtxo",
				},
				error,
			);
			throw error;
		}
	}

	async lockUtxos(utxoIds: string[]): Promise<void> {
		if (utxoIds.length === 0) return;
		const placeholders = utxoIds.map(() => "?").join(",");
		await this.db
			.prepare(`UPDATE nbtc_utxos SET status = 'locked' WHERE sui_id IN (${placeholders})`)
			.bind(...utxoIds)
			.run();
	}

	async insertRedeemRequest(r: RedeemRequestRecord): Promise<void> {
		await this.db
			.prepare(
				`INSERT OR IGNORE INTO nbtc_redeem_requests
            (redeem_id, redeemer, recipient_script, amount_sats, created_at, nbtc_pkg, sui_network)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				r.redeem_id,
				r.redeemer,
				r.recipient_script,
				r.amount_sats,
				r.created_at,
				r.nbtc_pkg,
				r.sui_network,
			)
			.run();
	}

	async getActivePackages(networkName: string): Promise<string[]> {
		const result = await this.db
			.prepare("SELECT nbtc_pkg FROM nbtc_addresses WHERE sui_network = ? AND active = 1")
			.bind(networkName)
			.all<{ nbtc_pkg: string }>();

		return result.results.map((r) => r.nbtc_pkg);
	}

	async getActiveNetworks(): Promise<SuiNet[]> {
		const result = await this.db
			.prepare("SELECT DISTINCT sui_network FROM nbtc_addresses WHERE active = 1")
			.all<{ sui_network: string }>();

		return result.results.map((r) => r.sui_network as SuiNet);
	}
}
