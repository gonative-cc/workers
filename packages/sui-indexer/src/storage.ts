import { logger } from "@gonative-cc/lib/logger";
import type { UtxoRecord } from "./models";

export class IndexerStorage {
	constructor(private db: D1Database) {}

	async getCursor(packageId: string): Promise<string | null> {
		const res = await this.db
			.prepare("SELECT value FROM indexer_state WHERE key = ?")
			.bind(packageId)
			.first<{ value: string }>();
		return res?.value || null;
	}

	async saveCursor(packageId: string, cursor: string): Promise<void> {
		await this.db
			.prepare(
				`INSERT INTO indexer_state (key, value, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
			)
			.bind(packageId, cursor, Date.now())
			.run();
	}

	async insertUtxos(utxos: UtxoRecord[]): Promise<void> {
		if (utxos.length === 0) return;

		const stmt = this.db.prepare(
			`INSERT OR REPLACE INTO nbtc_utxos
            (sui_id, txid, vout, amount_sats, script_pubkey, nbtc_pkg, sui_network, status, locked_until)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);

		const batch = utxos.map((u) =>
			stmt.bind(
				u.sui_id,
				u.txid,
				u.vout,
				u.amount_sats,
				u.script_pubkey,
				u.nbtc_pkg,
				u.sui_network,
				u.status,
				u.locked_until,
			),
		);

		try {
			await this.db.batch(batch);
		} catch (error) {
			logger.error({
				msg: "Failed to insert UTXOs batch",
				method: "insertUtxos",
				error: error,
			});
			throw error;
		}
	}
}
