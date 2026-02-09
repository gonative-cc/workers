import { logError } from "@gonative-cc/lib/logger";
import {
	UtxoStatus,
	type UtxoIngestData,
	type PkgCfg,
	type RedeemRequest,
	type Utxo,
	type IkaCursorUpdate,
	type RedeemSignInfo,
	type RedeemRequestIngestData,
} from "./models";
import {
	type RedeemRequestResp,
	type ConfirmingRedeemReq,
	RedeemRequestStatus,
} from "@gonative-cc/lib/rpc-types";
import { toSuiNet, type SuiNet } from "@gonative-cc/lib/nsui";
import { address, networks } from "bitcoinjs-lib";
import { BtcNet, btcNetFromString } from "@gonative-cc/lib/nbtc";

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
	nbtc_pkg: string;
	nbtc_contract: string;
	lc_pkg: string;
	lc_contract: string;
	sui_network: string;
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

export class D1Storage {
	constructor(private db: D1Database) {}

	// returns the latest cursor positions for multiple setups for querying Sui events.
	async getMultipleSuiGqlCursors(setupIds: number[]): Promise<Record<number, string | null>> {
		if (setupIds.length === 0) return {};

		const placeholders = setupIds.map(() => "?").join(",");
		const res = await this.db
			.prepare(
				`SELECT setup_id, nbtc_cursor FROM indexer_state WHERE setup_id IN (${placeholders})`,
			)
			.bind(...setupIds)
			.all<{ setup_id: number; nbtc_cursor: string }>();

		const result: Record<number, string | null> = {};
		setupIds.forEach((id) => {
			result[id] = null;
		});

		res.results.forEach((row) => {
			result[row.setup_id] = row.nbtc_cursor;
		});

		return result;
	}

	async getIkaCursors(coordinatorPkgIds: string[]): Promise<Record<string, string | null>> {
		if (coordinatorPkgIds.length === 0) return {};

		const placeholders = coordinatorPkgIds.map(() => "?").join(",");
		const res = await this.db
			.prepare(
				`SELECT coordinator_pkg_id, ika_cursor FROM ika_state WHERE coordinator_pkg_id IN (${placeholders})`,
			)
			.bind(...coordinatorPkgIds)
			.all<{ coordinator_pkg_id: string; ika_cursor: string }>();

		const result: Record<string, string | null> = {};
		coordinatorPkgIds.forEach((id) => {
			result[id] = null;
		});
		res.results.forEach((row) => {
			result[row.coordinator_pkg_id] = row.ika_cursor || null;
		});
		return result;
	}

	async saveIkaCursors(cursors: IkaCursorUpdate[]): Promise<void> {
		if (cursors.length === 0) return;

		const stmt = this.db.prepare(
			`INSERT INTO ika_state (coordinator_pkg_id, sui_network, ika_cursor, updated_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(sui_network, coordinator_pkg_id) DO UPDATE SET ika_cursor = excluded.ika_cursor, updated_at = excluded.updated_at`,
		);

		const now = Date.now();
		const batch = cursors.map(({ coordinatorPkgId, suiNetwork, cursor }) =>
			stmt.bind(coordinatorPkgId, suiNetwork, cursor, now),
		);
		await this.db.batch(batch);
	}

	async getIkaCoordinatorPkgsWithCursors(
		suiNetwork: SuiNet,
	): Promise<Record<string, string | null>> {
		const { results } = await this.db
			.prepare(
				`SELECT DISTINCT s.ika_pkg, i.ika_cursor
				 FROM setups s
				 LEFT JOIN ika_state i ON s.ika_pkg = i.coordinator_pkg_id AND i.sui_network = ?
				 WHERE s.sui_network = ? AND s.is_active = 1 AND s.ika_pkg IS NOT NULL`,
			)
			.bind(suiNetwork, suiNetwork)
			.all<{ ika_pkg: string; ika_cursor: string | null }>();

		const result: Record<string, string | null> = {};
		results.forEach((r) => {
			result[r.ika_pkg] = r.ika_cursor || null;
		});
		return result;
	}

	// Saves multiple cursor positions for querying Sui events.
	async saveMultipleSuiGqlCursors(cursors: { setupId: number; cursor: string }[]): Promise<void> {
		if (cursors.length === 0) return;

		const stmt = this.db.prepare(
			`INSERT INTO indexer_state (setup_id, nbtc_cursor, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(setup_id) DO UPDATE SET nbtc_cursor = excluded.nbtc_cursor, updated_at = excluded.updated_at`,
		);

		const now = Date.now();
		const batch = cursors.map(({ setupId, cursor }) => stmt.bind(setupId, cursor, now));

		await this.db.batch(batch);
	}

	async getSuiGqlCursor(setupId: number): Promise<string | null> {
		const result = await this.getMultipleSuiGqlCursors([setupId]);
		return result[setupId] || null;
	}

	async saveSuiGqlCursor(setupId: number, nbtcCursor: string): Promise<void> {
		await this.saveMultipleSuiGqlCursors([{ setupId, cursor: nbtcCursor }]);
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

		const stmt = this.db.prepare(
			`INSERT OR REPLACE INTO nbtc_utxos
			(nbtc_utxo_id, address_id, dwallet_id, txid, vout, amount, script_pubkey, status, locked_until)
			VALUES (?,
			  (SELECT id FROM nbtc_deposit_addresses WHERE deposit_address = ?),
			  ?, ?, ?, ?, ?, ?, ?)`,
		);
		try {
			await stmt
				.bind(
					u.nbtc_utxo_id,
					depositAddress,
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
		const { results } = await this.db
			.prepare("SELECT DISTINCT sui_network FROM setups WHERE is_active = 1")
			.all<{ sui_network: string }>();

		return results.map((r) => toSuiNet(r.sui_network));
	}

	async getPresignCount(network: SuiNet): Promise<number> {
		const result = await this.db
			.prepare("SELECT COUNT(*) as count FROM presign_objects WHERE sui_network = ?")
			.bind(network)
			.first<{ count: number }>();
		return Number(result?.count || 0);
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

	async clearRedeemInputSignId(redeemId: number, utxoId: number): Promise<void> {
		await this.db
			.prepare(
				`UPDATE nbtc_redeem_solutions SET sign_id = NULL WHERE redeem_id = ? AND utxo_id = ?`,
			)
			.bind(redeemId, utxoId)
			.run();
	}

	async getRedeemInfoBySignId(signId: string): Promise<RedeemSignInfo | null> {
		const query = `
			SELECT s.redeem_id, s.utxo_id, s.input_index, p.nbtc_pkg, p.nbtc_contract, p.sui_network
			FROM nbtc_redeem_solutions s
			JOIN nbtc_redeem_requests r ON s.redeem_id = r.redeem_id
			JOIN setups p ON r.setup_id = p.id
			WHERE s.sign_id = ?
		`;
		const result = await this.db.prepare(query).bind(signId).first<{
			redeem_id: number;
			utxo_id: number;
			input_index: number;
			nbtc_pkg: string;
			nbtc_contract: string;
			sui_network: string;
		}>();
		if (!result) return null;
		return { ...result, sui_network: toSuiNet(result.sui_network) };
	}

	async markRedeemSigning(redeemId: number): Promise<void> {
		try {
			await this.db
				.prepare("UPDATE nbtc_redeem_requests SET status = ? WHERE redeem_id = ?")
				.bind(RedeemRequestStatus.Signing, redeemId)
				.run();
		} catch (error) {
			logError(
				{
					msg: "Failed to mark redeem as signing",
					method: "markRedeemSigning",
					redeemId,
				},
				error,
			);
			throw error;
		}
	}

	// Returns transactions that have been broadcasted or are confirming in order to update the
	// confirmation status
	async getBroadcastedBtcRedeemTxIds(network: string): Promise<string[]> {
		const statuses = [
			RedeemRequestStatus.Broadcasting,
			RedeemRequestStatus.Confirming,
			RedeemRequestStatus.Reorg,
		];
		const placeholders = statuses.map(() => "?").join(",");

		const { results } = await this.db
			.prepare(
				`SELECT r.btc_tx
	                 FROM nbtc_redeem_requests r
	                 JOIN setups s ON r.setup_id = s.id
	                 WHERE s.btc_network = ?
	                 AND r.status IN (${placeholders})
	                 AND r.btc_tx IS NOT NULL`,
			)
			.bind(network, ...statuses)
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
                 WHERE status IN (?, ?, ?) AND btc_tx IN (${placeholders})`,
				)
				.bind(
					RedeemRequestStatus.Confirming,
					blockHeight,
					blockHash,
					RedeemRequestStatus.Broadcasting,
					RedeemRequestStatus.Confirming,
					RedeemRequestStatus.Reorg,
					...batch,
				)
				.run();
		}
	}

	async getConfirmingRedeems(network: string): Promise<ConfirmingRedeemReq[]> {
		const { results } = await this.db
			.prepare(
				`SELECT r.redeem_id, r.btc_tx, r.btc_block_height, r.btc_block_hash, s.btc_network
				 FROM nbtc_redeem_requests r
				 JOIN setups s ON r.setup_id = s.id
				 WHERE s.btc_network = ? AND r.status = ?`,
			)
			.bind(network, RedeemRequestStatus.Confirming)
			.all<ConfirmingRedeemReq>();
		return results;
	}

	async updateRedeemStatus(redeemId: number, status: RedeemRequestStatus): Promise<void> {
		await this.db
			.prepare("UPDATE nbtc_redeem_requests SET status = ? WHERE redeem_id = ?")
			.bind(status, redeemId)
			.run();
	}

	async updateRedeemStatuses(redeemIds: number[], status: RedeemRequestStatus): Promise<void> {
		if (redeemIds.length === 0) return;
		const placeholders = redeemIds.map(() => "?").join(",");
		await this.db
			.prepare(
				`UPDATE nbtc_redeem_requests SET status = ? WHERE redeem_id IN (${placeholders})`,
			)
			.bind(status, ...redeemIds)
			.run();
	}

	async setRedeemFinalized(redeemId: number): Promise<void> {
		const updateReq = this.db
			.prepare("UPDATE nbtc_redeem_requests SET status = ? WHERE redeem_id = ?")
			.bind(RedeemRequestStatus.Finalized, redeemId);

		const updateUtxos = this.db
			.prepare(
				`UPDATE nbtc_utxos
				 SET status = ?
				 WHERE nbtc_utxo_id IN (
					 SELECT utxo_id FROM nbtc_redeem_solutions WHERE redeem_id = ?
				 )`,
			)
			.bind(UtxoStatus.Spent, redeemId);

		await this.db.batch([updateReq, updateUtxos]);
	}

	async getPendingRedeems(): Promise<RedeemRequest[]> {
		const query = `
            SELECT
                r.redeem_id, r.setup_id, r.redeemer, r.recipient_script, r.amount, r.status, r.created_at,
                p.nbtc_pkg, p.nbtc_contract, p.lc_pkg, p.lc_contract, p.sui_network
            FROM nbtc_redeem_requests r
            JOIN setups p ON r.setup_id = p.id
            WHERE r.status = ?
            ORDER BY r.created_at ASC
            LIMIT 50;
        `;
		const { results } = await this.db
			.prepare(query)
			.bind(RedeemRequestStatus.Pending)
			.all<RedeemRequestRow>();

		return results.map((r) => ({
			...r,
			recipient_script: new Uint8Array(r.recipient_script),
			sui_network: toSuiNet(r.sui_network),
		}));
	}

	async getRedeemsBySuiAddr(setupId: number, redeemer: string): Promise<RedeemRequestResp[]> {
		const query = `
            SELECT
                r.redeem_id, r.recipient_script, r.amount, r.status, r.created_at, r.sui_tx, r.btc_tx
            FROM nbtc_redeem_requests r
            WHERE r.redeemer = ? AND r.setup_id = ?
            ORDER BY r.created_at DESC
        `;
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
		btcNetwork: BtcNet,
	): Promise<RedeemRequestResp[]> {
		const query = `
            SELECT
                r.redeem_id, r.recipient_script, r.amount, r.status, r.created_at, r.sui_tx, r.btc_tx
            FROM nbtc_redeem_requests r
            JOIN setups p ON r.setup_id = p.id
            WHERE r.redeemer = ? AND p.btc_network = ?
            ORDER BY r.created_at DESC
        `;
		const { results } = await this.db
			.prepare(query)
			.bind(redeemer, btcNetwork)
			.all<RedeemRequestResp>();

		// TODO handle confirmations
		for (const r of results) {
			r.confirmations = 0;
		}

		return results;
	}

	async getSigningRedeems(): Promise<RedeemRequestWithInputs[]> {
		const query = `
	     	SELECT
			    r.redeem_id, r.setup_id, r.redeemer, r.recipient_script, r.amount, r.status, r.created_at,
			    p.nbtc_pkg, p.nbtc_contract, p.lc_pkg, p.lc_contract, p.sui_network
			FROM nbtc_redeem_requests r
			JOIN setups p ON r.setup_id = p.id
			WHERE r.status = ?
			AND EXISTS (SELECT 1 FROM nbtc_redeem_solutions s WHERE s.redeem_id = r.redeem_id AND s.sign_id IS NULL)
			ORDER BY r.created_at ASC
			LIMIT 50;
	        `;
		const { results: requests } = await this.db
			.prepare(query)
			.bind(RedeemRequestStatus.Signing)
			.all<RedeemRequestRow>();

		if (requests.length === 0) {
			return [];
		}

		const redeemIds = requests.map((r) => r.redeem_id).join(",");
		const inputsQuery = `SELECT * FROM nbtc_redeem_solutions WHERE redeem_id IN (${redeemIds}) ORDER BY input_index ASC`;

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

		return requests.map((r) => ({
			...r,
			recipient_script: new Uint8Array(r.recipient_script),
			sui_network: toSuiNet(r.sui_network),
			inputs: inputsMap.get(r.redeem_id) || [],
		}));
	}

	async getRedeemsReadyForSolving(maxCreatedAt: number): Promise<RedeemRequest[]> {
		const query = `
            SELECT
                r.redeem_id, r.setup_id, r.redeemer, r.recipient_script, r.amount, r.status, r.created_at,
                p.nbtc_pkg, p.nbtc_contract, p.lc_pkg, p.lc_contract, p.sui_network
            FROM nbtc_redeem_requests r
            JOIN setups p ON r.setup_id = p.id
            WHERE r.status = ? AND r.created_at <= ?
            ORDER BY r.created_at ASC
            LIMIT 50;
        `;
		const { results } = await this.db
			.prepare(query)
			.bind(RedeemRequestStatus.Proposed, maxCreatedAt)
			.all<RedeemRequestRow>();

		return results.map((r) => ({
			...r,
			recipient_script: new Uint8Array(r.recipient_script),
			sui_network: toSuiNet(r.sui_network),
		}));
	}

	async getAvailableUtxos(setupId: number): Promise<Utxo[]> {
		// TODO: we should not query all utxos every time
		const query = `
			SELECT u.nbtc_utxo_id, u.dwallet_id, u.txid, u.vout, u.amount, u.script_pubkey, u.address_id, u.status, u.locked_until
			FROM nbtc_utxos u
			JOIN nbtc_deposit_addresses a ON u.address_id = a.id
			WHERE a.setup_id = ?
			AND u.status = ?
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
							`UPDATE nbtc_utxos SET status = ?, locked_until = ? WHERE nbtc_utxo_id IN (${placeholders})`,
						)
						.bind(UtxoStatus.Locked, lockUntil, ...chunk),
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
                p.nbtc_pkg, p.nbtc_contract, p.lc_pkg, p.lc_contract, p.sui_network, p.btc_network
            FROM nbtc_redeem_requests r
            JOIN setups p ON r.setup_id = p.id
            WHERE r.status = ?
            ORDER BY r.created_at ASC
            LIMIT 50;
        `;
		const { results } = await this.db
			.prepare(query)
			.bind(RedeemRequestStatus.Signed)
			.all<RedeemRequestRow & { btc_network: string }>();

		return results.map((r) => ({
			...r,
			recipient_script: new Uint8Array(r.recipient_script),
			sui_network: toSuiNet(r.sui_network),
			btc_network: btcNetFromString(r.btc_network),
		}));
	}

	async getRedeemWithSetup(redeemId: number): Promise<RedeemRequest | null> {
		const query = `
			SELECT
				r.redeem_id, r.setup_id, r.redeemer, r.recipient_script, r.amount, r.status, r.created_at,
				p.nbtc_pkg, p.nbtc_contract, p.lc_pkg, p.lc_contract, p.sui_network
			FROM nbtc_redeem_requests r
			JOIN setups p ON r.setup_id = p.id
			WHERE r.redeem_id = ?
		`;
		const result = await this.db.prepare(query).bind(redeemId).first<RedeemRequestRow>();

		if (!result) return null;

		return {
			...result,
			recipient_script: new Uint8Array(result.recipient_script),
			sui_network: toSuiNet(result.sui_network),
		};
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
