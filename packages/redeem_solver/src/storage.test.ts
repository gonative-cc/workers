import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { Miniflare } from "miniflare";
import { D1Storage, UTXO_LOCK_TIME_MS } from "./storage";
import {
	RedeemRequestStatus,
	UtxoStatus,
	type UtxoIngestData,
	type RedeemRequestIngestData,
} from "@gonative-cc/sui-indexer/models";
import { IndexerStorage } from "@gonative-cc/sui-indexer/storage";
import { initDb } from "./db.test";
import { toSuiNet, type SuiNet } from "@gonative-cc/lib/nsui";
import { payments, networks } from "bitcoinjs-lib";

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

describe("D1Storage", () => {
	let storage: D1Storage;
	let indexerStorage: IndexerStorage;
	let db: D1Database;

	const p2wpkh1 = payments.p2wpkh({
		pubkey: Buffer.from(
			"03b32dc780fba98db25b4b72cf2b69da228f5e10ca6aa8f46eabe7f9fe22c994ee",
			"hex",
		),
		network: networks.regtest,
	});
	const depositAddress1 = p2wpkh1.address!;
	const scriptPubkey1 = new Uint8Array(p2wpkh1.output!);

	const p2wpkh2 = payments.p2wpkh({
		pubkey: Buffer.from(
			"02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
			"hex",
		),
		network: networks.testnet,
	});
	const depositAddress2 = p2wpkh2.address!;
	const scriptPubkey2 = new Uint8Array(p2wpkh2.output!);

	const recipientScript = new Uint8Array([0x76, 0xa9, 0x14]).buffer;

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
		depositAddress: string,
		scriptPubkey: Uint8Array,
		dwalletId: string,
		txid: string,
		vout: number,
		amountSats: number,
		status: UtxoStatus,
		lockedUntil: number | null,
		nbtcPkg = "0xPkg1",
		suiNetwork: SuiNet = "devnet",
	) {
		const utxoData: UtxoIngestData = {
			nbtc_utxo_id: utxoId,
			dwallet_id: dwalletId,
			txid: txid,
			vout: vout,
			amount_sats: amountSats,
			script_pubkey: scriptPubkey,
			nbtc_pkg: nbtcPkg,
			sui_network: suiNetwork,
			status: status,
			locked_until: lockedUntil,
		};
		await indexerStorage.insertUtxo(utxoData);
	}

	async function insertSetup(
		database: D1Database,
		id: number,
		btcNetwork: string,
		suiNetwork: string,
		nbtcPkg: string,
		nbtcContract: string,
		lcPkg: string,
		lcContract: string,
		suiFallbackAddress: string,
		isActive = 1,
	) {
		await database
			.prepare(
				`INSERT INTO setups (id, btc_network, sui_network, nbtc_pkg, nbtc_contract, lc_pkg, lc_contract, sui_fallback_address, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				id,
				btcNetwork,
				suiNetwork,
				nbtcPkg,
				nbtcContract,
				lcPkg,
				lcContract,
				suiFallbackAddress,
				isActive,
			)
			.run();
	}

	async function insertDepositAddress(
		database: D1Database,
		id: number,
		setupId: number,
		depositAddress: string,
		isActive = 1,
	) {
		await database
			.prepare(
				`INSERT INTO nbtc_deposit_addresses (id, setup_id, deposit_address, is_active)
                 VALUES (?, ?, ?, ?)`,
			)
			.bind(id, setupId, depositAddress, isActive)
			.run();
	}

	beforeEach(async () => {
		db = await mf.getD1Database("DB");
		await initDb(db);

		storage = new D1Storage(db);
		indexerStorage = new IndexerStorage(db);

		await insertSetup(
			db,
			1,
			"regtest",
			"devnet",
			"0xPkg1",
			"0xContract1",
			"0xLC1",
			"0xLCC1",
			"0xFallback1",
		);
		await insertDepositAddress(db, 1, 1, depositAddress1);
	});

	afterEach(async () => {
		const db = await mf.getD1Database("DB");
		const tables = ["nbtc_utxos", "nbtc_redeem_requests", "nbtc_deposit_addresses", "setups"];
		const dropStms = tables.map((t) => `DROP TABLE IF EXISTS ${t};`).join(" ");
		await db.exec(dropStms);
	});

	it("getPendingRedeems should return pending redeems ordered by created_at", async () => {
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
		await insertUtxo(
			1,
			depositAddress1,
			scriptPubkey1,
			"dwallet1",
			"tx1",
			0,
			1000,
			UtxoStatus.Available,
			null,
		);
		await insertUtxo(
			2,
			depositAddress1,
			scriptPubkey1,
			"dwallet1",
			"tx2",
			0,
			5000,
			UtxoStatus.Available,
			null,
		);

		const utxos = await storage.getAvailableUtxos(1);

		expect(utxos.length).toBe(2);
		expect(utxos[0]!.nbtc_utxo_id).toBe(2);
		expect(utxos[1]!.nbtc_utxo_id).toBe(1);
	});

	it("getAvailableUtxos should filter by setup_id and status", async () => {
		await insertSetup(
			db,
			2,
			"testnet",
			"testnet",
			"0xPkg2",
			"0xContract2",
			"0xLC2",
			"0xLCC2",
			"0xFallback2",
		);
		await insertDepositAddress(db, 2, 2, depositAddress2);

		await insertUtxo(
			1,
			depositAddress1,
			scriptPubkey1,
			"dwallet1",
			"tx1",
			0,
			1000,
			UtxoStatus.Available,
			null,
		);
		await insertUtxo(
			3,
			depositAddress1,
			scriptPubkey1,
			"dwallet1",
			"tx_locked",
			0,
			2000,
			UtxoStatus.Locked,
			Date.now() + 10000,
		);
		await insertUtxo(
			2,
			depositAddress2,
			scriptPubkey2,
			"dwallet2",
			"tx2",
			0,
			3000,
			UtxoStatus.Available,
			null,
			"0xPkg2",
			"testnet",
		);

		const utxos1 = await storage.getAvailableUtxos(1);
		const utxos2 = await storage.getAvailableUtxos(2);

		expect(utxos1.length).toBe(1);
		expect(utxos1[0]!.nbtc_utxo_id).toBe(1);
		expect(utxos2.length).toBe(1);
		expect(utxos2[0]!.nbtc_utxo_id).toBe(2);
	});

	it("markRedeemProposed should update redeem status and lock utxos", async () => {
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
			depositAddress1,
			scriptPubkey1,
			"dwallet1",
			"tx1",
			0,
			2000,
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
		expect(utxo!.locked_until).toBeDefined();
	});

	it("markRedeemProposed should handle empty utxo array", async () => {
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

		await storage.markRedeemProposed(1, [], UTXO_LOCK_TIME_MS);

		const redeem = await db
			.prepare("SELECT status FROM nbtc_redeem_requests WHERE redeem_id = ?")
			.bind(1)
			.first<{ status: string }>();
		expect(redeem!.status).toBe(RedeemRequestStatus.Proposed);
	});

	it("markRedeemSolved should update redeem status", async () => {
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
