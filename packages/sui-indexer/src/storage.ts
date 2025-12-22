import { logError } from "@gonative-cc/lib/logger";
import {
	RedeemRequestStatus,
	UtxoStatus,
	type RedeemRequestIngestData,
	type UtxoIngestData,
} from "./models";
import type { SuiNet } from "@gonative-cc/lib/nsui";
import { address, networks } from "bitcoinjs-lib";
import { BtcNet } from "@gonative-cc/lib/nbtc";

const btcNetworks: Record<string, networks.Network> = {
	[BtcNet.MAINNET]: networks.bitcoin,
	[BtcNet.TESTNET]: networks.testnet,
	[BtcNet.REGTEST]: networks.regtest,
	[BtcNet.SIGNET]: networks.testnet,
};

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

	async insertUtxo(u: UtxoIngestData): Promise<void> {
		const pkgRow = await this.db
			.prepare(
				"SELECT id, btc_network FROM nbtc_packages WHERE nbtc_pkg = ? AND sui_network = ?",
			)
			.bind(u.nbtc_pkg, u.sui_network)
			.first<{ id: number; btc_network: string }>();

		if (!pkgRow) {
			throw new Error(
				`Package not found for nbtc_pkg=${u.nbtc_pkg}, sui_network=${u.sui_network}`,
			);
		}

		const network = btcNetworks[pkgRow.btc_network];
		if (!network) {
			throw new Error(`Unknown BTC network: ${pkgRow.btc_network}`);
		}
		let depositAddress: string;
		try {
			depositAddress = address.fromOutputScript(Buffer.from(u.script_pubkey), network);
		} catch (e) {
			throw new Error(`Failed to derive address from script_pubkey: ${e}`);
		}

		const addrRow = await this.db
			.prepare(
				"SELECT id FROM nbtc_deposit_addresses WHERE package_id = ? AND deposit_address = ?",
			)
			.bind(pkgRow.id, depositAddress)
			.first<{ id: number }>();

		if (!addrRow) {
			throw new Error(
				`Deposit address not found for package_id=${pkgRow.id}, address=${depositAddress}`,
			);
		}

		const stmt = this.db.prepare(
			`INSERT OR REPLACE INTO nbtc_utxos
            (nbtc_utxo_id, address_id, dwallet_id, txid, vout, amount_sats, script_pubkey, status, locked_until)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		try {
			await stmt
				.bind(
					u.nbtc_utxo_id,
					addrRow.id,
					u.dwallet_id,
					u.txid,
					u.vout,
					u.amount_sats,
					u.script_pubkey,
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

	async lockUtxos(utxoIds: number[]): Promise<void> {
		if (utxoIds.length === 0) return;
		const placeholders = utxoIds.map(() => "?").join(",");
		try {
			await this.db
				.prepare(`UPDATE nbtc_utxos SET status = ? WHERE nbtc_utxo_id IN (${placeholders})`)
				.bind(UtxoStatus.Locked, ...utxoIds)
				.run();
		} catch (error) {
			logError(
				{
					msg: "Failed to lock UTXOs",
					method: "lockUtxos",
				},
				error,
			);
			throw error;
		}
	}

	async insertRedeemRequest(r: RedeemRequestIngestData): Promise<void> {
		const pkgRow = await this.db
			.prepare("SELECT id FROM nbtc_packages WHERE nbtc_pkg = ? AND sui_network = ?")
			.bind(r.nbtc_pkg, r.sui_network)
			.first<{ id: number }>();

		if (!pkgRow) {
			throw new Error(
				`Package not found for nbtc_pkg=${r.nbtc_pkg}, sui_network=${r.sui_network}`,
			);
		}
		try {
			await this.db
				.prepare(
					`INSERT OR IGNORE INTO nbtc_redeem_requests
            (redeem_id, package_id, redeemer, recipient_script, amount_sats, created_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
				)
				.bind(
					r.redeem_id,
					pkgRow.id,
					r.redeemer,
					r.recipient_script,
					r.amount_sats,
					r.created_at,
					RedeemRequestStatus.Pending,
				)
				.run();
		} catch (error) {
			logError(
				{
					msg: "Failed to insert Redeem Request",
					method: "insertRedeemRequest",
					redeem_id: r.redeem_id,
					redeemer: r.redeemer,
					sui_network: r.sui_network,
				},
				error,
			);
			throw error;
		}
	}

	async getActiveNbtcPkgs(networkName: string): Promise<string[]> {
		const result = await this.db
			.prepare("SELECT nbtc_pkg FROM nbtc_packages WHERE sui_network = ? AND is_active = 1")
			.bind(networkName)
			.all<{ nbtc_pkg: string }>();

		return result.results.map((r) => r.nbtc_pkg);
	}

	async getActiveNetworks(): Promise<SuiNet[]> {
		const result = await this.db
			.prepare("SELECT DISTINCT sui_network FROM nbtc_packages WHERE is_active = 1")
			.all<{ sui_network: string }>();

		return result.results.map((r) => r.sui_network as SuiNet);
	}

	async upsertRedeemInputs(
		redeemId: number,
		utxoIds: number[],
		dwalletIds: string[],
	): Promise<void> {
		if (utxoIds.length !== dwalletIds.length) {
			throw new Error("Mismatched lengths of utxoIds and dwalletIds");
		}
		if (utxoIds.length === 0) return;

		const stmt = this.db.prepare(
			`INSERT OR IGNORE INTO nbtc_redeem_inputs (redeem_id, utxo_id, dwallet_id, created_at) VALUES (?, ?, ?, ?)`,
		);

		const now = Date.now();
		const batch = [];
		for (let i = 0; i < utxoIds.length; i++) {
			batch.push(stmt.bind(redeemId, utxoIds[i], dwalletIds[i], now));
		}
		try {
			await this.db.batch(batch);
		} catch (error) {
			logError(
				{
					msg: "Failed to upsert redeem inputs",
					method: "upsertRedeemInputs",
					redeemId,
				},
				error,
			);

			throw error;
		}
	}

	async markRedeemSolved(redeemId: number): Promise<void> {
		try {
			await this.db
				.prepare("UPDATE nbtc_redeem_requests SET status = ? WHERE redeem_id = ?")
				.bind(RedeemRequestStatus.Solved, redeemId)
				.run();
		} catch (error) {
			logError(
				{
					msg: "Failed to mark redeem as solved",
					method: "markRedeemSolved",
					redeemId,
				},
				error,
			);
			throw error;
		}
	}
}
