import { toSuiNet, type SuiNet } from "@gonative-cc/lib/nsui";
import {
	UtxoStatus,
	RedeemRequestStatus,
	type RedeemRequest,
	type RedeemRequestResp,
	type Utxo,
} from "@gonative-cc/sui-indexer/models";
import type { RedeemInput, RedeemRequestWithInputs } from "./models";

export const UTXO_LOCK_TIME_MS = 120000; // 2 minutes

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

export interface Storage {
	getPendingRedeems(): Promise<RedeemRequest[]>;
	getSolvedRedeems(): Promise<RedeemRequestWithInputs[]>;
	getRedeemsReadyForSolving(maxCreatedAt: number): Promise<RedeemRequest[]>;
	getAvailableUtxos(setupId: number): Promise<Utxo[]>;
	markRedeemProposed(redeemId: number, utxoIds: number[], utxoLockTimeMs: number): Promise<void>;
	markRedeemSolved(redeemId: number): Promise<void>;
	saveRedeemInputs(inputs: Omit<RedeemInput, "sign_id" | "verified">[]): Promise<void>;
	updateRedeemInputSig(redeemId: number, utxoId: number, signId: string): Promise<void>;
	markRedeemInputVerified(redeemId: number, utxoId: number): Promise<void>;
	getRedeemInputs(redeemId: number): Promise<RedeemInput[]>;
	getRedeemsBySuiAddr(redeemer: string, setupId: number): Promise<RedeemRequestResp[]>;
	getActiveNetworks(): Promise<SuiNet[]>;
	getSignedRedeems(): Promise<(RedeemRequest & { btc_network: string })[]>;
}

export class D1Storage implements Storage {
	constructor(private db: D1Database) {}

	async getPendingRedeems(): Promise<RedeemRequest[]> {
		const query = `
            SELECT
                r.redeem_id, r.setup_id, r.redeemer, r.recipient_script, r.amount, r.status, r.created_at,
                p.nbtc_pkg, p.nbtc_contract, p.sui_network
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

	async getRedeemsBySuiAddr(redeemer: string, setupId: number): Promise<RedeemRequestResp[]> {
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

	async getSolvedRedeems(): Promise<RedeemRequestWithInputs[]> {
		const query = `
	     	SELECT
			    r.redeem_id, r.setup_id, r.redeemer, r.recipient_script, r.amount, r.status, r.created_at,
			    p.nbtc_pkg, p.nbtc_contract, p.sui_network
			FROM nbtc_redeem_requests r
			JOIN setups p ON r.setup_id = p.id
			WHERE r.status = ?
			AND EXISTS (SELECT 1 FROM nbtc_redeem_solutions s WHERE s.redeem_id = r.redeem_id AND (s.sign_id IS NULL OR s.verified = 0))
			ORDER BY r.created_at ASC
			LIMIT 50;
	        `;
		const { results: requests } = await this.db
			.prepare(query)
			.bind(RedeemRequestStatus.Solved)
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
                p.nbtc_pkg, p.nbtc_contract, p.sui_network
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
			const placeholders = utxoIds.map(() => "?").join(", ");
			batch.push(
				this.db
					.prepare(
						`UPDATE nbtc_utxos SET status = ?, locked_until = ? WHERE nbtc_utxo_id IN (${placeholders})`,
					)
					.bind(UtxoStatus.Locked, lockUntil, ...utxoIds),
			);
		}
		await this.db.batch(batch);
	}

	async markRedeemSolved(redeemId: number): Promise<void> {
		await this.db
			.prepare(`UPDATE nbtc_redeem_requests SET status = ? WHERE redeem_id = ?`)
			.bind(RedeemRequestStatus.Solved, redeemId)
			.run();
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

	async markRedeemInputVerified(redeemId: number, utxoId: number): Promise<void> {
		await this.db
			.prepare(
				`UPDATE nbtc_redeem_solutions SET verified = 1 WHERE redeem_id = ? AND utxo_id = ?`,
			)
			.bind(redeemId, utxoId)
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
	async getActiveNetworks(): Promise<SuiNet[]> {
		const result = await this.db
			.prepare("SELECT DISTINCT sui_network FROM setups WHERE is_active = 1")
			.all<{ sui_network: string }>();

		return result.results.map((r) => toSuiNet(r.sui_network));
	}

	async getSignedRedeems(): Promise<(RedeemRequest & { btc_network: string })[]> {
		const query = `
            SELECT
                r.redeem_id, r.setup_id, r.redeemer, r.recipient_script, r.amount_sats, r.status, r.created_at,
                p.nbtc_pkg, p.nbtc_contract, p.sui_network, p.btc_network
            FROM nbtc_redeem_requests r
            JOIN setups p ON r.setup_id = p.id
            WHERE r.status = 'solved'
            AND NOT EXISTS (
                SELECT 1 FROM nbtc_redeem_solutions s
                WHERE s.redeem_id = r.redeem_id AND s.verified = 0
            )
            AND EXISTS (
                SELECT 1 FROM nbtc_redeem_solutions s
                WHERE s.redeem_id = r.redeem_id
            )
            ORDER BY r.created_at ASC
            LIMIT 50;
        `;
		const { results } = await this.db
			.prepare(query)
			.all<RedeemRequestRow & { btc_network: string }>();

		return results.map((r) => ({
			...r,
			recipient_script: new Uint8Array(r.recipient_script),
			sui_network: toSuiNet(r.sui_network),
		}));
	}
}
