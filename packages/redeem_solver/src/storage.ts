import { toSuiNet, type SuiNet } from "@gonative-cc/lib/nsui";
import {
	UtxoStatus,
	type RedeemRequest,
	RedeemRequestStatus,
	type Utxo,
} from "@gonative-cc/sui-indexer/models";
import type { RedeemInput, RedeemRequestWithInputs } from "./models";

interface RedeemRequestRow {
	redeem_id: number;
	package_id: number;
	redeemer: string;
	recipient_script: ArrayBuffer;
	amount_sats: number;
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
	amount_sats: number;
	script_pubkey: ArrayBuffer;
	address_id: number;
	status: UtxoStatus;
	locked_until: number | null;
}

export interface Storage {
	getPendingRedeems(): Promise<RedeemRequest[]>;
	getSolvedRedeems(): Promise<RedeemRequestWithInputs[]>;
	getRedeemsReadyForSolving(maxCreatedAt: number): Promise<RedeemRequest[]>;
	getAvailableUtxos(packageId: number): Promise<Utxo[]>;
	markRedeemProposed(redeemId: number, utxoIds: number[], utxoLockTimeMs: number): Promise<void>;
	markRedeemSolved(redeemId: number): Promise<void>;
	saveRedeemInputs(inputs: Omit<RedeemInput, "sign_id">[]): Promise<void>;
	updateInputSignature(redeemId: number, utxoId: number, signId: string): Promise<void>;
	getRedeemInputs(redeemId: number): Promise<RedeemInput[]>;
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

	async getSolvedRedeems(): Promise<RedeemRequestWithInputs[]> {
		const query = `
            SELECT
                r.redeem_id, r.package_id, r.redeemer, r.recipient_script, r.amount_sats, r.status, r.created_at,
                p.nbtc_pkg, p.nbtc_contract, p.sui_network
            FROM nbtc_redeem_requests r
            JOIN nbtc_packages p ON r.package_id = p.id
            WHERE r.status = ?
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

		const redeemIds = requests.map((r) => r.redeem_id);
		const placeholders = redeemIds.map(() => "?").join(",");
		const inputsQuery = `SELECT * FROM nbtc_redeem_inputs WHERE redeem_id IN (${placeholders}) ORDER BY created_at ASC`;

		const { results: inputs } = await this.db
			.prepare(inputsQuery)
			.bind(...redeemIds)
			.all<RedeemInput>();

		const inputsMap = new Map<number, RedeemInput[]>();
		for (const input of inputs) {
			const list = inputsMap.get(input.redeem_id);
			if (list) {
				list.push(input);
			} else {
				inputsMap.set(input.redeem_id, [input]);
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
                r.redeem_id, r.package_id, r.redeemer, r.recipient_script, r.amount_sats, r.status, r.created_at,
                p.nbtc_pkg, p.nbtc_contract, p.sui_network
            FROM nbtc_redeem_requests r
            JOIN nbtc_packages p ON r.package_id = p.id
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

	async getAvailableUtxos(packageId: number): Promise<Utxo[]> {
		// TODO: we should not query all utxos every time
		const query = `
			SELECT u.nbtc_utxo_id, u.dwallet_id, u.txid, u.vout, u.amount_sats, u.script_pubkey, u.address_id, u.status, u.locked_until
			FROM nbtc_utxos u
			JOIN nbtc_deposit_addresses a ON u.address_id = a.id
			WHERE a.package_id = ?
			AND u.status = ?
			ORDER BY u.amount_sats DESC;
		`;
		const { results } = await this.db
			.prepare(query)
			.bind(packageId, UtxoStatus.Available)
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

	async saveRedeemInputs(inputs: Omit<RedeemInput, "sign_id">[]): Promise<void> {
		if (inputs.length === 0) return;
		const stmt = this.db.prepare(
			`INSERT INTO nbtc_redeem_inputs (redeem_id, utxo_id, dwallet_id, created_at) VALUES (?, ?, ?, ?)`,
		);
		const batch = inputs.map((i) =>
			stmt.bind(i.redeem_id, i.utxo_id, i.dwallet_id, i.created_at),
		);
		await this.db.batch(batch);
	}

	async updateInputSignature(redeemId: number, utxoId: number, signId: string): Promise<void> {
		await this.db
			.prepare(
				`UPDATE nbtc_redeem_inputs SET sign_id = ? WHERE redeem_id = ? AND utxo_id = ?`,
			)
			.bind(signId, redeemId, utxoId)
			.run();
	}

	async getRedeemInputs(redeemId: number): Promise<RedeemInput[]> {
		return (
			await this.db
				.prepare(`SELECT * FROM nbtc_redeem_inputs WHERE redeem_id = ?`)
				.bind(redeemId)
				.all<RedeemInput>()
		).results;
	}

	async getActiveNetworks(): Promise<SuiNet[]> {
		const result = await this.db
			.prepare("SELECT DISTINCT sui_network FROM nbtc_packages WHERE is_active = 1")
			.all<{ sui_network: string }>();

		return result.results.map((r) => toSuiNet(r.sui_network));
	}
}
