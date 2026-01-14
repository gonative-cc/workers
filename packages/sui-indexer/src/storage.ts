import { logError } from "@gonative-cc/lib/logger";
import {
	RedeemRequestStatus,
	UtxoStatus,
	type RedeemRequestIngestData,
	type UtxoIngestData,
	type PkgCfg,
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
	// @setupId: setups row ID
	async getSuiGqlCursor(setupId: number): Promise<string | null> {
		const res = await this.db
			.prepare("SELECT nbtc_cursor FROM indexer_state WHERE setup_id = ?")
			.bind(setupId)
			.first<{ nbtc_cursor: string }>();
		return res?.nbtc_cursor || null;
	}

	// Saves the cursor position for querying Sui events.
	async saveSuiGqlCursor(setupId: number, nbtcCursor: string): Promise<void> {
		await this.db
			.prepare(
				`INSERT INTO indexer_state (setup_id, nbtc_cursor, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(setup_id) DO UPDATE SET nbtc_cursor = excluded.nbtc_cursor, updated_at = excluded.updated_at`,
			)
			.bind(setupId, nbtcCursor, Date.now())
			.run();
	}

	async insertUtxo(u: UtxoIngestData): Promise<void> {
		const setupRow = await this.db
			.prepare("SELECT btc_network FROM setups WHERE id = ?")
			.bind(u.setup_id)
			.first<{ id: number; btc_network: string }>();

		if (!setupRow) {
			throw new Error(`Setup not found for setup_id=${u.setup_id}`);
		}

		const network = btcNetworks[setupRow.btc_network];
		if (!network) {
			throw new Error(`Unknown BTC network: ${setupRow.btc_network}`);
		}
		let depositAddress: string;
		try {
			depositAddress = address.fromOutputScript(Buffer.from(u.script_pubkey), network);
		} catch (e) {
			throw new Error(`Failed to derive address from script_pubkey: ${e}`);
		}

		const addrRow = await this.db
			.prepare(
				"SELECT id FROM nbtc_deposit_addresses WHERE setup_id = ? AND deposit_address = ?",
			)
			.bind(u.setup_id, depositAddress)
			.first<{ id: number }>();

		if (!addrRow) {
			throw new Error(
				`Deposit address not found for setup_id=${u.setup_id}, address=${depositAddress}`,
			);
		}

		const stmt = this.db.prepare(
			`INSERT OR REPLACE INTO nbtc_utxos
            (nbtc_utxo_id, address_id, dwallet_id, txid, vout, amount, script_pubkey, status, locked_until)
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
					u.amount,
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

	// returns 1 if the insert happened, null otherwise.
	async insertRedeemRequest(r: RedeemRequestIngestData): Promise<number | null> {
		return insertRedeemRequest(this.db, r);
	}

	async getActiveNbtcPkgs(networkName: string): Promise<PkgCfg[]> {
		const result = await this.db
			.prepare("SELECT id, nbtc_pkg FROM setups WHERE sui_network = ? AND is_active = 1")
			.bind(networkName)
			.all<PkgCfg>();

		return result.results;
	}

	async getActiveNetworks(): Promise<SuiNet[]> {
		const result = await this.db
			.prepare("SELECT DISTINCT sui_network FROM setups WHERE is_active = 1")
			.all<{ sui_network: string }>();

		return result.results.map((r) => r.sui_network as SuiNet);
	}

	async upsertRedeemInputs(
		redeemId: number,
		utxoIds: number[],
		dwalletIds: string[],
	): Promise<void> {
		if (utxoIds.length !== dwalletIds.length) {
			const error = new Error(
				`Mismatch between utxoIds (${utxoIds.length}) and dwalletIds (${dwalletIds.length})`,
			);
			logError(
				{
					msg: "Failed to upsert redeem inputs: array length mismatch",
					method: "upsertRedeemInputs",
					redeemId,
				},
				error,
			);
			throw error;
		}

		if (utxoIds.length === 0) return;
		const now = Date.now();
		const stmt = this.db.prepare(
			`INSERT INTO nbtc_redeem_solutions (redeem_id, utxo_id, input_index, dwallet_id, created_at, verified)
             VALUES (?, ?, ?, ?, ?, 0)
             ON CONFLICT(redeem_id, utxo_id) DO NOTHING`,
		);

		const batch = utxoIds.map((utxoId, i) => {
			// dwalletIds[i] is guaranteed to exist due to length check
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			return stmt.bind(redeemId, utxoId, i, dwalletIds[i]!, now);
		});

		try {
			await this.db.batch(batch);
		} catch (error) {
			logError(
				{
					msg: "Failed to batch upsert redeem inputs in D1",
					method: "upsertRedeemInputs",
					redeemId,
				},
				error,
			);
			throw error;
		}
	}

	markRedeemInputVerified(redeemId: number, utxoId: number): Promise<void> {
		return this.db
			.prepare(
				`UPDATE nbtc_redeem_solutions SET verified = 1 WHERE redeem_id = ? AND utxo_id = ?`,
			)
			.bind(redeemId, utxoId)
			.run()
			.then();
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

export async function insertRedeemRequest(
	db: D1Database,
	r: RedeemRequestIngestData,
): Promise<number | null> {
	try {
		const result = await db
			.prepare(
				`INSERT OR IGNORE INTO nbtc_redeem_requests
        (redeem_id, setup_id, redeemer, recipient_script, amount, created_at, sui_tx, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING 1 as output`,
			)
			.bind(
				r.redeem_id,
				r.setup_id,
				r.redeemer,
				r.recipient_script,
				r.amount,
				r.created_at,
				r.sui_tx,
				RedeemRequestStatus.Pending,
			)
			.first<{ output: number }>();
		return result?.output || null;
	} catch (error) {
		logError(
			{
				msg: "Failed to insert Redeem Request",
				method: "insertRedeemRequest",
				redeem_id: r.redeem_id,
				redeemer: r.redeemer,
				setup_id: r.setup_id,
			},
			error,
		);
		throw error;
	}
}
