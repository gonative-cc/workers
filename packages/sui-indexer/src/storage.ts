import { logError } from "@gonative-cc/lib/logger";
import {
	RedeemRequestStatus,
	UtxoStatus,
	type RedeemRequestIngestData,
	type UtxoIngestData,
	type NbtcPkg,
	type RedeemRequest,
	type RedeemRequestResp,
	type Utxo,
} from "./models";
import { toSuiNet, type SuiNet } from "@gonative-cc/lib/nsui";
import { address, networks } from "bitcoinjs-lib";
import { BtcNet, btcNetFromString } from "@gonative-cc/lib/nbtc";
import { getActiveSetups, getSetup, type Setup } from "@gonative-cc/lib/setups";
import type { Cursor } from "./graphql-client";

// Types for redeem operations
export interface RedeemInput {
	redeem_id: number;
	utxo_id: number;
	input_index: number;
	dwallet_id: string;
	sign_id: string | null;
	verified: boolean;
	created_at: number;
}

export interface RedeemRequestWithInputs extends RedeemRequest {
	inputs: RedeemInput[];
}

export interface RedeemRequestWithNetwork extends RedeemRequest {
	btc_network: BtcNet;
}

export interface UtxoWithInputIndex extends Utxo {
	input_index: number;
}

export interface RedeemRequestData {
	recipient_script: Uint8Array;
	amount: number;
}

interface RedeemRequestRow {
	redeem_id: number;
	setup_id: number;
	redeemer: string;
	recipient_script: ArrayBuffer;
	amount: number;
	status: RedeemRequestStatus;
	created_at: number;
}

interface UtxoRow {
	nbtc_utxo_id: number;
	dwallet_id: string;
	txid: string;
	vout: number;
	amount: number;
	script_pubkey: ArrayBuffer;
	address_id: number;
	status: UtxoStatus;
	locked_until: number | null;
}

interface RedeemInputRow {
	redeem_id: number;
	utxo_id: number;
	input_index: number;
	dwallet_id: string;
	sign_id: string | null;
	verified: number;
	created_at: number;
}

const btcNetworks: Record<string, networks.Network> = {
	[BtcNet.MAINNET]: networks.bitcoin,
	[BtcNet.TESTNET]: networks.testnet,
	[BtcNet.REGTEST]: networks.regtest,
	[BtcNet.SIGNET]: networks.testnet,
};

// Storage for the Sui Indexer.
// The indexer operates on the Sui Network and Packages level, hence queries are usually
// by Sui network or by Sui network and package.
export class D1Storage {
	activeSetups: Setup[];

	constructor(
		private db: D1Database,
		setupEnv: string,
	) {
		this.activeSetups = getActiveSetups(setupEnv);
	}

	getSuiNetworks(): SuiNet[] {
		const l: SuiNet[] = [];
		for (const s of this.activeSetups) {
			if (l.indexOf(s.sui_network) < 0) l.push(s.sui_network);
		}
		return l;
	}

	getNbtcPkgs(net: SuiNet): NbtcPkg[] {
		const l: NbtcPkg[] = [];
		for (const s of this.activeSetups) {
			if (s.sui_network == net) {
				l.push({ setup_id: s.id, nbtc_pkg: s.nbtc_pkg });
			}
		}
		return l;
	}

	async getNbtcGqlCursor(setupId: number): Promise<Cursor> {
		const res = await this.db
			.prepare(`SELECT nbtc_cursor FROM indexer_state WHERE setup_id IN = ?`)
			.bind(setupId)
			.first<{ nbtc_cursor: Cursor }>();

		return res ? res.nbtc_cursor : null;
	}

	// returns mapping: setup_id -> cursor state for querying Sui events.
	async getNbtcGqlCursors(net: SuiNet): Promise<Record<number, Cursor>> {
		const setupIds = this.activeSetups.filter((s) => s.sui_network === net).map((s) => s.id);
		if (setupIds.length === 0) return {};

		const setupIdsStr = setupIds.join(",");
		const res = await this.db
			.prepare(
				`SELECT setup_id, nbtc_cursor FROM indexer_state WHERE setup_id IN (${setupIdsStr})`,
			)
			.all<{ setup_id: number; nbtc_cursor: Cursor }>();

		const result: Record<number, Cursor> = {};
		// for new setups without cursor state we want to return null
		for (const s of setupIds) result[s] = null;
		for (const r of res.results) result[r.setup_id] = r.nbtc_cursor;

		return result;
	}

	// Saves multiple cursor positions for querying Sui events.
	async saveNbtcGqlCursors(cursors: { setupId: number; cursor: Cursor }[]): Promise<void> {
		if (cursors.length === 0) return;

		const stmt = this.db.prepare(
			`INSERT INTO indexer_state (setup_id, nbtc_cursor, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(setup_id) DO UPDATE SET nbtc_cursor = excluded.nbtc_cursor, updated_at = excluded.updated_at`,
		);

		const now = Date.now();
		const batch = cursors.map((c) => stmt.bind(c.setupId, c.cursor, now));

		await this.db.batch(batch);
	}

	async insertUtxo(u: UtxoIngestData): Promise<void> {
		const setup = getSetup(u.setup_id);
		if (!setup) {
			throw new Error(`Setup not found for setup_id=${u.setup_id}`);
		}

		const network = btcNetworks[setup.btc_network];
		if (!network) {
			throw new Error(`Unknown BTC network=${setup.btc_network} for setup=${setup.id}`);
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
		// TODO: verify numbers and list length instead of creating binding
		const placeholders = utxoIds.map(() => "?").join(",");
		try {
			await this.db
				.prepare(
					`UPDATE nbtc_utxos SET status = '${UtxoStatus.Locked}' WHERE nbtc_utxo_id IN (${placeholders});`,
				)
				.bind(...utxoIds)
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

	async popPresignObject(network: SuiNet): Promise<string | null> {
		const result = await this.db
			.prepare(
				`DELETE FROM presign_objects
				  WHERE presign_id = (SELECT presign_id FROM presign_objects WHERE sui_network = ? ORDER BY created_at ASC LIMIT 1)
				  RETURNING presign_id`,
			)
			.bind(network)
			.first<{ presign_id: string }>();

		return result?.presign_id || null;
	}

	async insertPresignObject(presignId: string, network: SuiNet): Promise<void> {
		await this.db
			.prepare(
				"INSERT INTO presign_objects (presign_id, sui_network, created_at) VALUES (?, ?, ?)",
			)
			.bind(presignId, network, Date.now())
			.run();
	}

	async hasRedeemRequest(redeemId: number): Promise<boolean> {
		const ok = await this.db
			.prepare("SELECT 1 FROM nbtc_redeem_requests WHERE redeem_id = ?")
			.bind(redeemId)
			.first();
		return !!ok;
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

	async markRedeemInputVerified(redeemId: number, utxoId: number): Promise<void> {
		const updateSolution = this.db
			.prepare(
				`UPDATE nbtc_redeem_solutions SET verified = 1 WHERE redeem_id = ? AND utxo_id = ?`,
			)
			.bind(redeemId, utxoId);

		const updateRequest = this.db
			.prepare(
				`UPDATE nbtc_redeem_requests
                 SET status = ?
                 WHERE redeem_id = ?
                 AND NOT EXISTS (
                    SELECT 1 FROM nbtc_redeem_solutions
                    WHERE redeem_id = ? AND verified = 0
                 )`,
			)
			.bind(RedeemRequestStatus.Signed, redeemId, redeemId);

		await this.db.batch([updateSolution, updateRequest]);
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

	// Returns transaction IDs that have been broadcasted or are confirming in order to update
	// the confirmation status.
	async getBroadcastedBtcRedeemTxIds(net: BtcNet): Promise<string[]> {
		const setupIds = this.activeSetups.filter((s) => s.btc_network === net).map((s) => s.id);
		if (setupIds.length === 0) return [];

		// TODO: should we include Reorg here?
		const statuses = strListToSqlInContent([
			RedeemRequestStatus.Broadcasting,
			RedeemRequestStatus.Confirming,
		]);
		const { results } = await this.db
			.prepare(
				`SELECT r.btc_tx
				 FROM nbtc_redeem_requests r
				 WHERE r.setup_id IN (${setupIds.join(",")})
				 AND r.status IN (${statuses}) AND r.btc_tx IS NOT NULL`,
			)
			.all<{ btc_tx: string }>();
		return results.map((r) => r.btc_tx);
	}
	async markRedeemBroadcasted(redeemId: number, txId: string): Promise<void> {
		const now = Date.now();
		await this.db
			.prepare(
				`UPDATE nbtc_redeem_requests
                 SET status = ?, btc_tx = ?, btc_broadcasted_at = ?
                 WHERE redeem_id = ?`,
			)
			.bind(RedeemRequestStatus.Broadcasting, txId, now, redeemId)
			.run();
	}

	async confirmRedeem(txIds: string[], blockHeight: number, blockHash: string): Promise<void> {
		if (txIds.length === 0) return;

		const batchSize = 100;
		for (let i = 0; i < txIds.length; i += batchSize) {
			const batch = txIds.slice(i, i + batchSize);
			const placeholders = batch.map(() => "?").join(",");
			await this.db
				.prepare(
					`UPDATE nbtc_redeem_requests
                 SET status = ?, btc_block_height = ?, btc_block_hash = ?
                 WHERE status = ? AND btc_tx IN (${placeholders})`,
				)
				.bind(
					RedeemRequestStatus.Confirming,
					blockHeight,
					blockHash,
					RedeemRequestStatus.Broadcasting,
					...batch,
				)
				.run();
		}
	}

	// TODO: add pagination
	async getPendingRedeems(): Promise<RedeemRequest[]> {
		const query = `
		SELECT r.redeem_id, r.setup_id, r.redeemer, r.recipient_script, r.amount, r.status, r.created_at
		FROM nbtc_redeem_requests r
		WHERE r.status = '${RedeemRequestStatus.Pending}'
		ORDER BY r.created_at DESC
		LIMIT 80;`;
		const { results } = await this.db.prepare(query).all<RedeemRequestRow>();

		// TODO: frontend should have info about setup, so the setup content should not be needed
		return results.map((r) => {
			const s = getSetup(r.setup_id)!;
			return {
				...r,
				recipient_script: new Uint8Array(r.recipient_script),
				sui_network: toSuiNet(s.sui_network),
				nbtc_pkg: s.nbtc_pkg,
				nbtc_contract: s.nbtc_contract,
			};
		});
	}

	async getRedeemsBySuiAddr(setupId: number, redeemer: string): Promise<RedeemRequestResp[]> {
		const query = `
		SELECT
		  r.redeem_id, r.recipient_script, r.amount, r.status, r.created_at, r.sui_tx, r.btc_tx
		FROM nbtc_redeem_requests r
		WHERE r.redeemer = ? AND r.setup_id = ?
		ORDER BY r.created_at DESC; `;
		const { results } = await this.db
			.prepare(query)
			.bind(redeemer, setupId)
			.all<RedeemRequestResp>();

		// TODO handle confirmations
		for (const r of results) {
			r.confirmations = 0;
		}

		return results;
	}

	async getRedeemsByAddrAndNetwork(
		redeemer: string,
		btcNet: BtcNet,
	): Promise<RedeemRequestResp[]> {
		const setupIds = this.activeSetups.filter((s) => s.btc_network === btcNet).map((s) => s.id);
		if (setupIds.length === 0) return [];

		const query = `
		SELECT
		  r.redeem_id, r.recipient_script, r.amount, r.status, r.created_at, r.sui_tx, r.btc_tx
		FROM nbtc_redeem_requests r
		WHERE r.redeemer = ? AND r.setup_id IN (${setupIds.join(",")})
		ORDER BY r.created_at DESC
        `;
		const { results } = await this.db.prepare(query).bind(redeemer).all<RedeemRequestResp>();

		// TODO handle confirmations
		for (const r of results) {
			r.confirmations = 0;
		}

		return results;
	}

	// TODO: should query by setup id
	async getSolvedRedeems(): Promise<RedeemRequestWithInputs[]> {
		const query = `
		SELECT r.redeem_id, r.setup_id, r.redeemer, r.recipient_script, r.amount, r.status, r.created_at
		FROM nbtc_redeem_requests r
		WHERE r.status = '${RedeemRequestStatus.Solved}'
		  AND EXISTS (SELECT 1 FROM nbtc_redeem_solutions s
		              WHERE s.redeem_id = r.redeem_id AND (s.sign_id IS NULL OR s.verified = 0))
		ORDER BY r.created_at DESC
		LIMIT 50;`;
		const { results: requests } = await this.db.prepare(query).all<RedeemRequestRow>();
		if (requests.length === 0) {
			return [];
		}

		const redeemIds = requests.map((r) => r.redeem_id).join(",");
		const inputsQuery = `SELECT * FROM nbtc_redeem_solutions
		                     WHERE redeem_id IN (${redeemIds}) ORDER BY input_index ASC`;
		const { results: inputs } = await this.db.prepare(inputsQuery).all<RedeemInputRow>();

		const inputsMap = new Map<number, RedeemInput[]>();
		for (const input of inputs) {
			const mappedInput: RedeemInput = {
				...input,
				verified: input.verified === 1,
			};
			const list = inputsMap.get(input.redeem_id);
			if (list) {
				list.push(mappedInput);
			} else {
				inputsMap.set(input.redeem_id, [mappedInput]);
			}
		}

		return requests.map((r) => {
			const s = getSetup(r.setup_id)!;
			return {
				...r,
				recipient_script: new Uint8Array(r.recipient_script),
				sui_network: toSuiNet(s.sui_network),
				inputs: inputsMap.get(r.redeem_id) || [],
				nbtc_pkg: s.nbtc_pkg,
				nbtc_contract: s.nbtc_contract,
			};
		});
	}

	async getRedeemsReadyForSolving(maxCreatedAt: number): Promise<RedeemRequest[]> {
		const query = `
		SELECT
		  r.redeem_id, r.setup_id, r.redeemer, r.recipient_script, r.amount, r.status, r.created_at,
		FROM nbtc_redeem_requests r
		WHERE r.status = ? AND r.created_at <= ?
		ORDER BY r.created_at DESC
		LIMIT 50;
        `;
		const { results } = await this.db
			.prepare(query)
			.bind(RedeemRequestStatus.Proposed, maxCreatedAt)
			.all<RedeemRequestRow>();

		// TODO: frontend should have info about setup, so the setup content should not be needed
		return results.map((r) => {
			const s = getSetup(r.setup_id)!;
			return {
				...r,
				recipient_script: new Uint8Array(r.recipient_script),
				sui_network: toSuiNet(s.sui_network),
				nbtc_pkg: s.nbtc_pkg,
				nbtc_contract: s.nbtc_contract,
			};
		});
	}

	async getAvailableUtxos(setupId: number): Promise<Utxo[]> {
		// TODO: we should not query all utxos every time
		const query = `
		SELECT u.nbtc_utxo_id, u.dwallet_id, u.txid, u.vout, u.amount, u.script_pubkey, u.address_id, u.status, u.locked_until
		FROM nbtc_utxos u
		JOIN nbtc_deposit_addresses a ON u.address_id = a.id
		WHERE a.setup_id = ? AND u.status = ?
		ORDER BY u.amount DESC;
		`;
		const { results } = await this.db
			.prepare(query)
			.bind(setupId, UtxoStatus.Available)
			.all<UtxoRow>();

		return results.map((u) => ({
			...u,
			script_pubkey: new Uint8Array(u.script_pubkey),
		}));
	}

	// Mark the redeem request as proposed and lock the selected UTXOs
	async markRedeemProposed(
		redeemId: number,
		utxoIds: number[],
		utxoLockTimeMs: number,
	): Promise<void> {
		const batch = [];
		batch.push(
			this.db
				.prepare(`UPDATE nbtc_redeem_requests SET status = ? WHERE redeem_id = ?`)
				.bind(RedeemRequestStatus.Proposed, redeemId),
		);
		const lockUntil = Date.now() + utxoLockTimeMs;

		if (utxoIds.length > 0) {
			const batchSize = 100;
			for (let i = 0; i < utxoIds.length; i += batchSize) {
				const chunk = utxoIds.slice(i, i + batchSize);
				const placeholders = chunk.map(() => "?").join(", ");
				batch.push(
					this.db
						.prepare(
							`UPDATE nbtc_utxos SET status = '${UtxoStatus.Locked}', locked_until = ${lockUntil} WHERE nbtc_utxo_id IN (${placeholders})`,
						)
						.bind(...chunk),
				);
			}
		}
		await this.db.batch(batch);
	}

	async saveRedeemInputs(inputs: Omit<RedeemInput, "sign_id" | "verified">[]): Promise<void> {
		if (inputs.length === 0) return;
		const stmt = this.db.prepare(
			`INSERT INTO nbtc_redeem_solutions (redeem_id, utxo_id, input_index, dwallet_id, created_at, verified) VALUES (?, ?, ?, ?, ?, 0)`,
		);
		const batch = inputs.map((i) =>
			stmt.bind(i.redeem_id, i.utxo_id, i.input_index, i.dwallet_id, i.created_at),
		);
		await this.db.batch(batch);
	}

	async updateRedeemInputSig(redeemId: number, utxoId: number, signId: string): Promise<void> {
		await this.db
			.prepare(
				`UPDATE nbtc_redeem_solutions SET sign_id = ? WHERE redeem_id = ? AND utxo_id = ?`,
			)
			.bind(signId, redeemId, utxoId)
			.run();
	}

	async getRedeemInputs(redeemId: number): Promise<RedeemInput[]> {
		const results = await this.db
			.prepare(
				`SELECT * FROM nbtc_redeem_solutions WHERE redeem_id = ? ORDER BY input_index ASC`,
			)
			.bind(redeemId)
			.all<RedeemInputRow>();

		return results.results.map((r) => ({
			...r,
			verified: r.verified === 1,
		}));
	}

	async getRedeemUtxosWithDetails(redeemId: number): Promise<UtxoWithInputIndex[]> {
		const query = `
			SELECT
				u.nbtc_utxo_id, u.dwallet_id, u.txid, u.vout, u.amount,
				u.script_pubkey, u.address_id, u.status, u.locked_until,
				s.input_index
			FROM nbtc_redeem_solutions s
			JOIN nbtc_utxos u ON s.utxo_id = u.nbtc_utxo_id
			WHERE s.redeem_id = ?
			ORDER BY s.input_index ASC
		`;
		const { results } = await this.db
			.prepare(query)
			.bind(redeemId)
			.all<UtxoRow & { input_index: number }>();

		return results.map((r) => ({
			...r,
			script_pubkey: new Uint8Array(r.script_pubkey),
		}));
	}

	async getRedeemRequestData(redeemId: number): Promise<RedeemRequestData | null> {
		const result = await this.db
			.prepare(
				`SELECT recipient_script, amount FROM nbtc_redeem_requests WHERE redeem_id = ?`,
			)
			.bind(redeemId)
			.first<{ recipient_script: ArrayBuffer; amount: number }>();

		if (!result) {
			return null;
		}

		return {
			recipient_script: new Uint8Array(result.recipient_script),
			amount: result.amount,
		};
	}

	async getSignedRedeems(): Promise<RedeemRequestWithNetwork[]> {
		const query = `
		SELECT
		  r.redeem_id, r.setup_id, r.redeemer, r.recipient_script, r.amount, r.status, r.created_at,
		FROM nbtc_redeem_requests r
		WHERE r.status = '${RedeemRequestStatus.Signed}'
		ORDER BY r.created_at ASC
		LIMIT 50;`;
		const { results } = await this.db
			.prepare(query)
			.all<RedeemRequestRow & { btc_network: string }>();

		return results.map((r) => {
			const s = getSetup(r.setup_id)!;
			return {
				...r,
				recipient_script: new Uint8Array(r.recipient_script),
				sui_network: toSuiNet(s.sui_network),
				btc_network: btcNetFromString(s.btc_network),
				nbtc_pkg: s.nbtc_pkg,
				nbtc_contract: s.nbtc_contract,
			};
		});
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

// To be used only with predefined strings, without any special character!
function strListToSqlInContent(vals: string[]): string {
	return vals.map((s) => `'${s}'`).join(",");
}
