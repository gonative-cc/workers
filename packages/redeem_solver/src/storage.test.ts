import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { Miniflare } from "miniflare";
import { D1Storage, UTXO_LOCK_TIME_MS } from "./storage";
import { RedeemRequestStatus, UtxoStatus } from "@gonative-cc/sui-indexer/models";
import { initDb } from "./db.test";
import { toSuiNet } from "@gonative-cc/lib/nsui";

let mf: Miniflare;

beforeAll(async () => {
	mf = new Miniflare({
		script: "",
		modules: true,
		d1Databases: ["DB"],
		d1Persist: false,
	});
});

afterAll(async () => {
	await mf.dispose();
});

beforeEach(async () => {
	const db = await mf.getD1Database("DB");
	await initDb(db);
});

afterEach(async () => {
	const db = await mf.getD1Database("DB");
	const tables = ["nbtc_utxos", "nbtc_redeem_requests", "nbtc_deposit_addresses", "setups"];
	const dropStms = tables.map((t) => `DROP TABLE IF EXISTS ${t};`).join(" ");
	await db.exec(dropStms);
});

describe("D1Storage", () => {
	let storage: D1Storage;
	let db: D1Database;

	async function insertRedeemRequest(
		redeemId: number,
		setupId: number,
		packageId: number,
		redeemer: string,
		recipientScript: ArrayBuffer,
		amountSats: number,
		createdAt: number,
		status: RedeemRequestStatus,
	) {
		await db
			.prepare(
				`INSERT INTO nbtc_redeem_requests (redeem_id, setup_id, package_id, redeemer, recipient_script, amount_sats, created_at, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				redeemId,
				setupId,
				packageId,
				redeemer,
				recipientScript,
				amountSats,
				createdAt,
				status,
			)
			.run();
	}

	async function insertUtxo(
		utxoId: number,
		addressId: number,
		dwalletId: string,
		txid: string,
		vout: number,
		amountSats: number,
		scriptPubkey: ArrayBuffer,
		status: UtxoStatus,
		lockedUntil: number | null,
	) {
		await db
			.prepare(
				`INSERT INTO nbtc_utxos (nbtc_utxo_id, address_id, dwallet_id, txid, vout, amount_sats, script_pubkey, status, locked_until)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				utxoId,
				addressId,
				dwalletId,
				txid,
				vout,
				amountSats,
				scriptPubkey,
				status,
				lockedUntil,
			)
			.run();
	}

	beforeEach(async () => {
		db = await mf.getD1Database("DB");
		storage = new D1Storage(db);
		await db
			.prepare(
				`INSERT INTO setups (id, btc_network, sui_network, nbtc_pkg, nbtc_contract, lc_pkg, lc_contract, sui_fallback_address, is_active)
                 VALUES (1, 'regtest', 'devnet', '0xPkg1', '0xContract1', '0xLC1', '0xLCC1', '0xFallback1', 1)`,
			)
			.run();
		await db
			.prepare(
				`INSERT INTO nbtc_deposit_addresses (id, setup_id, deposit_address, is_active)
                 VALUES (1, 1, 'bcrt1qAddress1', 1)`,
			)
			.run();
	});

	it("getPendingRedeems should return pending redeems ordered by created_at", async () => {
		const recipientScript = new Uint8Array([0x76, 0xa9, 0x14]).buffer;

		await insertRedeemRequest(
			2,
			1,
			1,
			"redeemer1",
			recipientScript,
			5000,
			2000,
			RedeemRequestStatus.Pending,
		);
		await insertRedeemRequest(
			1,
			1,
			1,
			"redeemer1",
			recipientScript,
			3000,
			1000,
			RedeemRequestStatus.Pending,
		);

		const redeems = await storage.getPendingRedeems();

		expect(redeems.length).toBe(2);
		expect(redeems[0]!.redeem_id).toBe(1);
		expect(redeems[1]!.redeem_id).toBe(2);
		expect(redeems[0]!.sui_network).toBe(toSuiNet("devnet"));
	});

	it("getRedeemsReadyForSolving should filter by status and created_at", async () => {
		const recipientScript = new Uint8Array([0x76, 0xa9, 0x14]).buffer;
		const now = Date.now();

		await insertRedeemRequest(
			1,
			1,
			1,
			"redeemer1",
			recipientScript,
			3000,
			now - 5000,
			RedeemRequestStatus.Proposed,
		);
		await insertRedeemRequest(
			2,
			1,
			1,
			"redeemer1",
			recipientScript,
			5000,
			now + 5000,
			RedeemRequestStatus.Proposed,
		);

		const redeems = await storage.getRedeemsReadyForSolving(now);

		expect(redeems.length).toBe(1);
		expect(redeems[0]!.redeem_id).toBe(1);
	});

	it("getAvailableUtxos should return utxos ordered by amount DESC", async () => {
		const scriptPubkey = new Uint8Array([0x00, 0x14]).buffer;

		await insertUtxo(
			1,
			1,
			"dwallet1",
			"tx1",
			0,
			1000,
			scriptPubkey,
			UtxoStatus.Available,
			null,
		);
		await insertUtxo(
			2,
			1,
			"dwallet1",
			"tx2",
			0,
			5000,
			scriptPubkey,
			UtxoStatus.Available,
			null,
		);

		const utxos = await storage.getAvailableUtxos(1);

		expect(utxos.length).toBe(2);
		expect(utxos[0]!.nbtc_utxo_id).toBe(2);
		expect(utxos[1]!.nbtc_utxo_id).toBe(1);
	});

	it("getAvailableUtxos should filter by setup_id and status", async () => {
		const scriptPubkey = new Uint8Array([0x00, 0x14]).buffer;

		await db
			.prepare(
				`INSERT INTO setups (id, btc_network, sui_network, nbtc_pkg, nbtc_contract, lc_pkg, lc_contract, sui_fallback_address, is_active)
                 VALUES (2, 'testnet', 'testnet', '0xPkg2', '0xContract2', '0xLC2', '0xLCC2', '0xFallback2', 1)`,
			)
			.run();

		await db
			.prepare(
				`INSERT INTO nbtc_deposit_addresses (id, setup_id, deposit_address, is_active)
                 VALUES (2, 2, 'tb1qAddress2', 1)`,
			)
			.run();

		await insertUtxo(
			1,
			1,
			"dwallet1",
			"tx1",
			0,
			1000,
			scriptPubkey,
			UtxoStatus.Available,
			null,
		);
		await insertUtxo(
			3,
			1,
			"dwallet1",
			"tx_locked",
			0,
			2000,
			scriptPubkey,
			UtxoStatus.Locked,
			Date.now() + 10000,
		);
		await insertUtxo(
			2,
			2,
			"dwallet2",
			"tx2",
			0,
			3000,
			scriptPubkey,
			UtxoStatus.Available,
			null,
		);

		const utxos1 = await storage.getAvailableUtxos(1);
		const utxos2 = await storage.getAvailableUtxos(2);

		expect(utxos1.length).toBe(1);
		expect(utxos1[0]!.nbtc_utxo_id).toBe(1);
		expect(utxos2.length).toBe(1);
		expect(utxos2[0]!.nbtc_utxo_id).toBe(2);
	});

	it("markRedeemProposed should update redeem status and lock utxos", async () => {
		const recipientScript = new Uint8Array([0x76, 0xa9, 0x14]).buffer;
		const scriptPubkey = new Uint8Array([0x00, 0x14]).buffer;

		await insertRedeemRequest(
			1,
			1,
			1,
			"redeemer1",
			recipientScript,
			3000,
			1000,
			RedeemRequestStatus.Pending,
		);
		await insertUtxo(
			1,
			1,
			"dwallet1",
			"tx1",
			0,
			2000,
			scriptPubkey,
			UtxoStatus.Available,
			null,
		);

		await storage.markRedeemProposed(1, [1], UTXO_LOCK_TIME_MS);

		const redeem = await db
			.prepare("SELECT status FROM nbtc_redeem_requests WHERE redeem_id = ?")
			.bind(1)
			.first<{ status: string }>();
		expect(redeem!.status).toBe(RedeemRequestStatus.Proposed);

		const utxo = await db
			.prepare("SELECT status, locked_until FROM nbtc_utxos WHERE nbtc_utxo_id = ?")
			.bind(1)
			.first<{ status: string; locked_until: number }>();
		expect(utxo!.status).toBe(UtxoStatus.Locked);
		expect(utxo!.locked_until).toBeGreaterThan(Date.now());
	});

	it("markRedeemSolved should update redeem status", async () => {
		const recipientScript = new Uint8Array([0x76, 0xa9, 0x14]).buffer;

		await insertRedeemRequest(
			1,
			1,
			1,
			"redeemer1",
			recipientScript,
			3000,
			1000,
			RedeemRequestStatus.Proposed,
		);

		await storage.markRedeemSolved(1);

		const redeem = await db
			.prepare("SELECT status FROM nbtc_redeem_requests WHERE redeem_id = ?")
			.bind(1)
			.first<{ status: string }>();
		expect(redeem!.status).toBe(RedeemRequestStatus.Solved);
	});

	it("getActiveNetworks should return distinct active networks", async () => {
		await db
			.prepare(
				`INSERT INTO setups (id, btc_network, sui_network, nbtc_pkg, nbtc_contract, lc_pkg, lc_contract, sui_fallback_address, is_active)
                 VALUES (2, 'mainnet', 'mainnet', '0xPkg2', '0xContract2', '0xLC2', '0xLCC2', '0xFallback2', 1)`,
			)
			.run();
		await db
			.prepare(
				`INSERT INTO setups (id, btc_network, sui_network, nbtc_pkg, nbtc_contract, lc_pkg, lc_contract, sui_fallback_address, is_active)
                 VALUES (3, 'testnet', 'testnet', '0xPkg3', '0xContract3', '0xLC3', '0xLCC3', '0xFallback3', 0)`,
			)
			.run();

		const networks = await storage.getActiveNetworks();

		expect(networks.length).toBe(2);
		expect(networks).toContain(toSuiNet("devnet"));
		expect(networks).toContain(toSuiNet("mainnet"));
		expect(networks).not.toContain(toSuiNet("testnet"));
	});
});
