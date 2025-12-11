import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { Miniflare } from "miniflare";
import { D1Storage } from "./storage";
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
	const tables = [
		"nbtc_utxos",
		"nbtc_redeem_requests",
		"nbtc_deposit_addresses",
		"nbtc_packages",
	];
	const dropStms = tables.map((t) => `DROP TABLE IF EXISTS ${t};`).join(" ");
	await db.exec(dropStms);
});

describe("D1Storage", () => {
	let storage: D1Storage;
	let db: D1Database;

	beforeEach(async () => {
		db = await mf.getD1Database("DB");
		storage = new D1Storage(db);
		await db
			.prepare(
				`INSERT INTO nbtc_packages (id, btc_network, sui_network, nbtc_pkg, nbtc_contract, lc_pkg, lc_contract, sui_fallback_address, is_active)
                 VALUES (1, 'regtest', 'devnet', '0xPkg1', '0xContract1', '0xLC1', '0xLCC1', '0xFallback1', 1)`,
			)
			.run();
		await db
			.prepare(
				`INSERT INTO nbtc_deposit_addresses (id, package_id, deposit_address, is_active)
                 VALUES (1, 1, 'bcrt1qAddress1', 1)`,
			)
			.run();
	});

	it("getPendingRedeems should return pending redeems ordered by created_at", async () => {
		const recipientScript = new Uint8Array([0x76, 0xa9, 0x14]);

		await db
			.prepare(
				`INSERT INTO nbtc_redeem_requests (redeem_id, package_id, redeemer, recipient_script, amount_sats, created_at, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				"redeem2",
				1,
				"redeemer1",
				recipientScript,
				5000,
				2000,
				RedeemRequestStatus.Pending,
			)
			.run();

		await db
			.prepare(
				`INSERT INTO nbtc_redeem_requests (redeem_id, package_id, redeemer, recipient_script, amount_sats, created_at, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				"redeem1",
				1,
				"redeemer1",
				recipientScript,
				3000,
				1000,
				RedeemRequestStatus.Pending,
			)
			.run();

		const redeems = await storage.getPendingRedeems();

		expect(redeems.length).toBe(2);
		expect(redeems[0]!.redeem_id).toBe("redeem1");
		expect(redeems[1]!.redeem_id).toBe("redeem2");
		expect(redeems[0]!.sui_network).toBe(toSuiNet("devnet"));
	});

	it("getRedeemsReadyForSolving should filter by status and created_at", async () => {
		const recipientScript = new Uint8Array([0x76, 0xa9, 0x14]);
		const now = Date.now();

		await db
			.prepare(
				`INSERT INTO nbtc_redeem_requests (redeem_id, package_id, redeemer, recipient_script, amount_sats, created_at, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				"redeem1",
				1,
				"redeemer1",
				recipientScript,
				3000,
				now - 5000,
				RedeemRequestStatus.Proposed,
			)
			.run();

		await db
			.prepare(
				`INSERT INTO nbtc_redeem_requests (redeem_id, package_id, redeemer, recipient_script, amount_sats, created_at, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				"redeem2",
				1,
				"redeemer1",
				recipientScript,
				5000,
				now + 5000,
				RedeemRequestStatus.Proposed,
			)
			.run();

		const redeems = await storage.getRedeemsReadyForSolving(now);

		expect(redeems.length).toBe(1);
		expect(redeems[0]!.redeem_id).toBe("redeem1");
	});

	it("getAvailableUtxos should return utxos ordered by amount DESC", async () => {
		const scriptPubkey = new Uint8Array([0x00, 0x14]);

		await db
			.prepare(
				`INSERT INTO nbtc_utxos (nbtc_utxo_id, address_id, dwallet_id, txid, vout, amount_sats, script_pubkey, status, locked_until)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind("utxo1", 1, "dwallet1", "tx1", 0, 1000, scriptPubkey, UtxoStatus.Available, null)
			.run();

		await db
			.prepare(
				`INSERT INTO nbtc_utxos (nbtc_utxo_id, address_id, dwallet_id, txid, vout, amount_sats, script_pubkey, status, locked_until)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind("utxo2", 1, "dwallet1", "tx2", 0, 5000, scriptPubkey, UtxoStatus.Available, null)
			.run();

		const utxos = await storage.getAvailableUtxos(1);

		expect(utxos.length).toBe(2);
		expect(utxos[0]!.nbtc_utxo_id).toBe("utxo2");
		expect(utxos[1]!.nbtc_utxo_id).toBe("utxo1");
	});

	it("getAvailableUtxos should filter by package_id and status", async () => {
		const scriptPubkey = new Uint8Array([0x00, 0x14]);

		await db
			.prepare(
				`INSERT INTO nbtc_packages (id, btc_network, sui_network, nbtc_pkg, nbtc_contract, lc_pkg, lc_contract, sui_fallback_address, is_active)
                 VALUES (2, 'testnet', 'testnet', '0xPkg2', '0xContract2', '0xLC2', '0xLCC2', '0xFallback2', 1)`,
			)
			.run();

		await db
			.prepare(
				`INSERT INTO nbtc_deposit_addresses (id, package_id, deposit_address, is_active)
                 VALUES (2, 2, 'tb1qAddress2', 1)`,
			)
			.run();

		await db
			.prepare(
				`INSERT INTO nbtc_utxos (nbtc_utxo_id, address_id, dwallet_id, txid, vout, amount_sats, script_pubkey, status, locked_until)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind("utxo1", 1, "dwallet1", "tx1", 0, 1000, scriptPubkey, UtxoStatus.Available, null)
			.run();

		await db
			.prepare(
				`INSERT INTO nbtc_utxos (nbtc_utxo_id, address_id, dwallet_id, txid, vout, amount_sats, script_pubkey, status, locked_until)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				"utxo_locked",
				1,
				"dwallet1",
				"tx_locked",
				0,
				2000,
				scriptPubkey,
				UtxoStatus.Locked,
				Date.now() + 10000,
			)
			.run();

		await db
			.prepare(
				`INSERT INTO nbtc_utxos (nbtc_utxo_id, address_id, dwallet_id, txid, vout, amount_sats, script_pubkey, status, locked_until)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind("utxo2", 2, "dwallet2", "tx2", 0, 3000, scriptPubkey, UtxoStatus.Available, null)
			.run();

		const utxos1 = await storage.getAvailableUtxos(1);
		const utxos2 = await storage.getAvailableUtxos(2);

		expect(utxos1.length).toBe(1);
		expect(utxos1[0]!.nbtc_utxo_id).toBe("utxo1");
		expect(utxos2.length).toBe(1);
		expect(utxos2[0]!.nbtc_utxo_id).toBe("utxo2");
	});

	it("markRedeemProposed should update redeem status and lock utxos", async () => {
		const recipientScript = new Uint8Array([0x76, 0xa9, 0x14]);
		const scriptPubkey = new Uint8Array([0x00, 0x14]);
		const lockTimeMs = 60000;

		await db
			.prepare(
				`INSERT INTO nbtc_redeem_requests (redeem_id, package_id, redeemer, recipient_script, amount_sats, created_at, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				"redeem1",
				1,
				"redeemer1",
				recipientScript,
				3000,
				1000,
				RedeemRequestStatus.Pending,
			)
			.run();

		await db
			.prepare(
				`INSERT INTO nbtc_utxos (nbtc_utxo_id, address_id, dwallet_id, txid, vout, amount_sats, script_pubkey, status, locked_until)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind("utxo1", 1, "dwallet1", "tx1", 0, 2000, scriptPubkey, UtxoStatus.Available, null)
			.run();

		await storage.markRedeemProposed("redeem1", ["utxo1"], lockTimeMs);

		const redeem = await db
			.prepare("SELECT status FROM nbtc_redeem_requests WHERE redeem_id = ?")
			.bind("redeem1")
			.first<{ status: string }>();
		expect(redeem!.status).toBe(RedeemRequestStatus.Proposed);

		const utxo = await db
			.prepare("SELECT status, locked_until FROM nbtc_utxos WHERE nbtc_utxo_id = ?")
			.bind("utxo1")
			.first<{ status: string; locked_until: number }>();
		expect(utxo!.status).toBe(UtxoStatus.Locked);
		expect(utxo!.locked_until).toBeGreaterThan(Date.now());
	});

	it("markRedeemSolved should update redeem status", async () => {
		const recipientScript = new Uint8Array([0x76, 0xa9, 0x14]);

		await db
			.prepare(
				`INSERT INTO nbtc_redeem_requests (redeem_id, package_id, redeemer, recipient_script, amount_sats, created_at, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				"redeem1",
				1,
				"redeemer1",
				recipientScript,
				3000,
				1000,
				RedeemRequestStatus.Proposed,
			)
			.run();

		await storage.markRedeemSolved("redeem1");

		const redeem = await db
			.prepare("SELECT status FROM nbtc_redeem_requests WHERE redeem_id = ?")
			.bind("redeem1")
			.first<{ status: string }>();
		expect(redeem!.status).toBe(RedeemRequestStatus.Solved);
	});

	it("getActiveNetworks should return distinct active networks", async () => {
		await db
			.prepare(
				`INSERT INTO nbtc_packages (id, btc_network, sui_network, nbtc_pkg, nbtc_contract, lc_pkg, lc_contract, sui_fallback_address, is_active)
                 VALUES (2, 'mainnet', 'mainnet', '0xPkg2', '0xContract2', '0xLC2', '0xLCC2', '0xFallback2', 1)`,
			)
			.run();

		const networks = await storage.getActiveNetworks();

		expect(networks.length).toBe(2);
		expect(networks).toContain(toSuiNet("devnet"));
		expect(networks).toContain(toSuiNet("mainnet"));
	});
});
