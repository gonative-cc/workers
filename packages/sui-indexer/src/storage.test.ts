import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { Miniflare } from "miniflare";
import { D1Storage } from "./storage";
import { UtxoStatus, type UtxoIngestData, type RedeemRequestIngestData } from "./models";
import { RedeemRequestStatus } from "@gonative-cc/lib/rpc-types";
import { toSuiNet } from "@gonative-cc/lib/nsui";
import { payments, networks } from "bitcoinjs-lib";
import { dropTables, initDb } from "@gonative-cc/lib/test-helpers/init_db";

export const UTXO_LOCK_TIME_MS = 120000; // 2 minutes

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

const recipientScript = new Uint8Array([0x76, 0xa9, 0x14]);

async function insertRedeemRequest(
	indexerStorage: D1Storage,
	redeemId: number,
	redeemer: string,
	recipientScript: Uint8Array,
	amount: number,
	createdAt: number,
	suiTx: string,
	setupId = 1,
) {
	const redeemData: RedeemRequestIngestData = {
		redeem_id: redeemId,
		redeemer: redeemer,
		recipient_script: recipientScript,
		amount: amount,
		created_at: createdAt,
		setup_id: setupId,
		sui_tx: suiTx,
	};
	await indexerStorage.insertRedeemRequest(redeemData);
}

async function insertUtxo(
	indexerStorage: D1Storage,
	utxoId: number,
	scriptPubkey: Uint8Array,
	dwalletId: string,
	txid: string,
	vout: number,
	amount: number,
	status: UtxoStatus,
	lockedUntil: number | null,
	setupId = 1,
) {
	const utxoData: UtxoIngestData = {
		nbtc_utxo_id: utxoId,
		dwallet_id: dwalletId,
		txid: txid,
		vout: vout,
		amount: amount,
		script_pubkey: scriptPubkey,
		setup_id: setupId,
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
	nbtcFallbackAddr: string,
	isActive = 1,
) {
	await database
		.prepare(
			`INSERT INTO setups (id, btc_network, sui_network, nbtc_pkg, nbtc_contract, lc_pkg, lc_contract, nbtc_fallback_addr, is_active)
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
			nbtcFallbackAddr,
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

describe("IndexerStorage", () => {
	let storage: D1Storage;
	let db: D1Database;

	beforeEach(async () => {
		db = await mf.getD1Database("DB");
		await initDb(db);

		storage = new D1Storage(db);

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

	afterEach(() => dropTables(db));

	it("should manage presign objects", async () => {
		const presignId1 = "presign1";
		const presignId2 = "presign2";
		const net1 = "testnet";
		const net2 = "mainnet";

		await storage.insertPresignObject(presignId1, net1);
		await storage.insertPresignObject(presignId2, net2);

		const popped1 = await storage.popPresignObject(net1);
		expect(popped1).toBe(presignId1);

		const popped2 = await storage.popPresignObject(net2);
		expect(popped2).toBe(presignId2);

		const popped3 = await storage.popPresignObject(net1);
		expect(popped3).toBeNull();
	});

	it("should count presign objects", async () => {
		const net1 = "testnet";
		await storage.insertPresignObject("presign1", net1);
		await storage.insertPresignObject("presign2", net1);
		await storage.insertPresignObject("presign3", "mainnet");

		const count = await storage.getPresignCount(net1);
		expect(count).toBe(2);

		const countMain = await storage.getPresignCount("mainnet");
		expect(countMain).toBe(1);

		const countEmpty = await storage.getPresignCount("devnet");
		expect(countEmpty).toBe(0);
	});

	it("getPendingRedeems should return pending redeems ordered by created_at", async () => {
		await insertRedeemRequest(storage, 2, "redeemer1", recipientScript, 5000, 2000, "0xSuiTx2");
		await insertRedeemRequest(storage, 1, "redeemer1", recipientScript, 3000, 1000, "0xSuiTx1");

		const redeems = await storage.getPendingRedeems();

		expect(redeems.length).toBe(2);
		expect(redeems[0]!.redeem_id).toBe(1);
		expect(redeems[1]!.redeem_id).toBe(2);
		expect(redeems[0]!.sui_network).toBe(toSuiNet("devnet"));
	});

	it("getRedeemsReadyForSolving should filter by status and created_at", async () => {
		const now = Date.now();
		await insertRedeemRequest(
			storage,
			1,
			"redeemer1",
			recipientScript,
			3000,
			now - 5000,
			"0xSuiTx1",
		);
		await insertRedeemRequest(
			storage,
			2,
			"redeemer1",
			recipientScript,
			5000,
			now + 5000,
			"0xSuiTx2",
		);
		await db
			.prepare("UPDATE nbtc_redeem_requests SET status = ? WHERE redeem_id IN (?, ?)")
			.bind(RedeemRequestStatus.Proposed, 1, 2)
			.run();

		const redeems = await storage.getRedeemsReadyForSolving(now);

		expect(redeems.length).toBe(1);
		expect(redeems[0]!.redeem_id).toBe(1);
	});

	it("getAvailableUtxos should return utxos ordered by amount DESC", async () => {
		await insertUtxo(
			storage,
			1,
			scriptPubkey1,
			"dwallet1",
			"tx1",
			0,
			1000,
			UtxoStatus.Available,
			null,
		);
		await insertUtxo(
			storage,
			2,
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
			storage,
			1,
			scriptPubkey1,
			"dwallet1",
			"tx1",
			0,
			1000,
			UtxoStatus.Available,
			null,
		);
		await insertUtxo(
			storage,
			3,
			scriptPubkey1,
			"dwallet1",
			"tx_locked",
			0,
			2000,
			UtxoStatus.Locked,
			Date.now() + 10000,
		);
		await insertUtxo(
			storage,
			2,
			scriptPubkey2,
			"dwallet2",
			"tx2",
			0,
			3000,
			UtxoStatus.Available,
			null,
			2,
		);

		const utxos1 = await storage.getAvailableUtxos(1);
		const utxos2 = await storage.getAvailableUtxos(2);

		expect(utxos1.length).toBe(1);
		expect(utxos1[0]!.nbtc_utxo_id).toBe(1);
		expect(utxos2.length).toBe(1);
		expect(utxos2[0]!.nbtc_utxo_id).toBe(2);
	});

	it("markRedeemProposed should update redeem status and lock utxos", async () => {
		await insertRedeemRequest(storage, 1, "redeemer1", recipientScript, 3000, 1000, "0xSuiTx1");
		await insertUtxo(
			storage,
			1,
			scriptPubkey1,
			"dwallet1",
			"tx1",
			0,
			2000,
			UtxoStatus.Available,
			null,
		);

		const beforeLock = Date.now();
		await storage.markRedeemProposed(1, [1], UTXO_LOCK_TIME_MS);
		const afterLock = Date.now();

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
		expect(utxo!.locked_until).toBeGreaterThanOrEqual(beforeLock + UTXO_LOCK_TIME_MS);
		expect(utxo!.locked_until).toBeLessThanOrEqual(afterLock + UTXO_LOCK_TIME_MS);
	});

	it("markRedeemSigning should update redeem status", async () => {
		await insertRedeemRequest(storage, 1, "redeemer1", recipientScript, 3000, 1000, "0xSuiTx1");
		await db
			.prepare("UPDATE nbtc_redeem_requests SET status = ? WHERE redeem_id = ?")
			.bind(RedeemRequestStatus.Proposed, 1)
			.run();

		await storage.markRedeemSigning(1);

		const redeem = await db
			.prepare("SELECT status FROM nbtc_redeem_requests WHERE redeem_id = ?")
			.bind(1)
			.first<{ status: string }>();
		expect(redeem!.status).toBe(RedeemRequestStatus.Signing);
	});

	it("getActiveNetworks should return distinct active networks", async () => {
		await db
			.prepare(
				`INSERT INTO setups (id, btc_network, sui_network, nbtc_pkg, nbtc_contract, lc_pkg, lc_contract, nbtc_fallback_addr, is_active)
                 VALUES (2, 'mainnet', 'mainnet', '0xPkg2', '0xContract2', '0xLC2', '0xLCC2', '0xFallback2', 1)`,
			)
			.run();
		await db
			.prepare(
				`INSERT INTO setups (id, btc_network, sui_network, nbtc_pkg, nbtc_contract, lc_pkg, lc_contract, nbtc_fallback_addr, is_active)
                 VALUES (3, 'testnet', 'testnet', '0xPkg3', '0xContract3', '0xLC3', '0xLCC3', '0xFallback3', 0)`,
			)
			.run();

		const networks = await storage.getActiveNetworks();

		expect(networks.length).toBe(2);
		expect(networks).toContain(toSuiNet("devnet"));
		expect(networks).toContain(toSuiNet("mainnet"));
		expect(networks).not.toContain(toSuiNet("testnet"));
	});

	it("getSigningRedeems should return signing redeems with inputs", async () => {
		await insertRedeemRequest(storage, 1, "redeemer1", recipientScript, 3000, 1000, "0xSuiTx1");
		await insertUtxo(
			storage,
			1,
			scriptPubkey1,
			"dwallet1",
			"tx1",
			0,
			2000,
			UtxoStatus.Available,
			null,
		);
		await storage.markRedeemProposed(1, [1], UTXO_LOCK_TIME_MS);
		await storage.markRedeemSigning(1);
		await storage.saveRedeemInputs([
			{
				redeem_id: 1,
				utxo_id: 1,
				input_index: 0,
				dwallet_id: "dwallet1",
				created_at: Date.now(),
			},
		]);

		const redeems = await storage.getSigningRedeems();

		expect(redeems.length).toBe(1);
		expect(redeems[0]!.redeem_id).toBe(1);
		expect(redeems[0]!.inputs.length).toBe(1);
		expect(redeems[0]!.inputs[0]!.utxo_id).toBe(1);
		expect(redeems[0]!.inputs[0]!.verified).toBe(false);
	});

	it("getRedeemsBySuiAddr should return redeems for a specific address", async () => {
		await insertRedeemRequest(storage, 1, "redeemer1", recipientScript, 3000, 1000, "0xSuiTx1");
		await insertRedeemRequest(storage, 2, "redeemer2", recipientScript, 5000, 2000, "0xSuiTx2");

		const redeems = await storage.getRedeemsBySuiAddr(1, "redeemer1");

		expect(redeems.length).toBe(1);
		expect(redeems[0]!.redeem_id).toBe(1);
		expect(redeems[0]!.amount).toBe(3000);
	});

	it("saveRedeemInputs should save redeem solutions", async () => {
		await insertRedeemRequest(storage, 1, "redeemer1", recipientScript, 3000, 1000, "0xSuiTx1");
		await insertUtxo(
			storage,
			1,
			scriptPubkey1,
			"dwallet1",
			"tx1",
			0,
			2000,
			UtxoStatus.Available,
			null,
		);

		await storage.saveRedeemInputs([
			{
				redeem_id: 1,
				utxo_id: 1,
				input_index: 0,
				dwallet_id: "dwallet1",
				created_at: Date.now(),
			},
		]);

		const inputs = await storage.getRedeemInputs(1);
		expect(inputs.length).toBe(1);
		expect(inputs[0]!.utxo_id).toBe(1);
		expect(inputs[0]!.verified).toBe(false);
		expect(inputs[0]!.sign_id).toBeNull();
	});

	it("updateRedeemInputSig should update signature", async () => {
		await insertRedeemRequest(storage, 1, "redeemer1", recipientScript, 3000, 1000, "0xSuiTx1");
		await insertUtxo(
			storage,
			1,
			scriptPubkey1,
			"dwallet1",
			"tx1",
			0,
			2000,
			UtxoStatus.Available,
			null,
		);
		await storage.saveRedeemInputs([
			{
				redeem_id: 1,
				utxo_id: 1,
				input_index: 0,
				dwallet_id: "dwallet1",
				created_at: Date.now(),
			},
		]);

		await storage.updateRedeemInputSig(1, 1, "signId123");

		const inputs = await storage.getRedeemInputs(1);
		expect(inputs[0]!.sign_id).toBe("signId123");
	});

	it("markRedeemInputVerified should mark input as verified", async () => {
		await insertRedeemRequest(storage, 1, "redeemer1", recipientScript, 3000, 1000, "0xSuiTx1");
		await insertUtxo(
			storage,
			1,
			scriptPubkey1,
			"dwallet1",
			"tx1",
			0,
			2000,
			UtxoStatus.Available,
			null,
		);
		await storage.saveRedeemInputs([
			{
				redeem_id: 1,
				utxo_id: 1,
				input_index: 0,
				dwallet_id: "dwallet1",
				created_at: Date.now(),
			},
		]);

		await storage.markRedeemInputVerified(1, 1);

		const inputs = await storage.getRedeemInputs(1);
		expect(inputs[0]!.verified).toBe(true);
	});

	it("getRedeemInputs should return inputs ordered by input_index", async () => {
		await insertRedeemRequest(storage, 1, "redeemer1", recipientScript, 5000, 1000, "0xSuiTx1");
		await insertUtxo(
			storage,
			1,
			scriptPubkey1,
			"dwallet1",
			"tx1",
			0,
			2000,
			UtxoStatus.Available,
			null,
		);
		await insertUtxo(
			storage,
			2,
			scriptPubkey1,
			"dwallet1",
			"tx2",
			0,
			3000,
			UtxoStatus.Available,
			null,
		);
		await storage.saveRedeemInputs([
			{
				redeem_id: 1,
				utxo_id: 2,
				input_index: 1,
				dwallet_id: "dwallet1",
				created_at: Date.now(),
			},
			{
				redeem_id: 1,
				utxo_id: 1,
				input_index: 0,
				dwallet_id: "dwallet1",
				created_at: Date.now(),
			},
		]);

		const inputs = await storage.getRedeemInputs(1);
		expect(inputs.length).toBe(2);
		expect(inputs[0]!.input_index).toBe(0);
		expect(inputs[1]!.input_index).toBe(1);
	});

	it("should save and retrieve multiple cursors", async () => {
		await insertSetup(db, 2, "testnet", "testnet", "0xPkg2", "0xC2", "0xL2", "0xLC2", "0xF2");

		await storage.saveMultipleSuiGqlCursors([
			{ setupId: 1, cursor: "cursor1" },
			{ setupId: 2, cursor: "cursor2" },
		]);

		const cursors = await storage.getMultipleSuiGqlCursors([1, 2, 3]);
		expect(cursors[1]).toBe("cursor1");
		expect(cursors[2]).toBe("cursor2");
		expect(cursors[3]).toBeNull();
	});

	it("markRedeemBroadcasted should update status and set btc_tx", async () => {
		await insertRedeemRequest(storage, 1, "redeemer1", recipientScript, 3000, 1000, "0xSuiTx1");
		await db
			.prepare("UPDATE nbtc_redeem_requests SET status = ? WHERE redeem_id = ?")
			.bind(RedeemRequestStatus.Signed, 1)
			.run();

		const beforeBroadcast = Date.now();
		await storage.markRedeemBroadcasted(1, "btc_tx_123");
		const afterBroadcast = Date.now();

		const redeem = await db
			.prepare(
				"SELECT status, btc_tx, btc_broadcasted_at FROM nbtc_redeem_requests WHERE redeem_id = ?",
			)
			.bind(1)
			.first<{ status: string; btc_tx: string; btc_broadcasted_at: number }>();

		expect(redeem!.status).toBe(RedeemRequestStatus.Broadcasting);
		expect(redeem!.btc_tx).toBe("btc_tx_123");
		expect(redeem!.btc_broadcasted_at).toBeGreaterThanOrEqual(beforeBroadcast);
		expect(redeem!.btc_broadcasted_at).toBeLessThanOrEqual(afterBroadcast);
	});

	it("confirmRedeem should update status and block info for multiple txs", async () => {
		await insertRedeemRequest(storage, 1, "redeemer1", recipientScript, 3000, 1000, "0xSuiTx1");
		await insertRedeemRequest(storage, 2, "redeemer1", recipientScript, 5000, 2000, "0xSuiTx2");

		await storage.markRedeemBroadcasted(1, "btc_tx_1");
		await storage.markRedeemBroadcasted(2, "btc_tx_2");

		await storage.confirmRedeem(["btc_tx_1", "btc_tx_2"], 100, "blockhash123");

		const redeem1 = await db
			.prepare(
				"SELECT status, btc_block_height, btc_block_hash FROM nbtc_redeem_requests WHERE redeem_id = ?",
			)
			.bind(1)
			.first<{ status: string; btc_block_height: number; btc_block_hash: string }>();

		const redeem2 = await db
			.prepare(
				"SELECT status, btc_block_height, btc_block_hash FROM nbtc_redeem_requests WHERE redeem_id = ?",
			)
			.bind(2)
			.first<{ status: string; btc_block_height: number; btc_block_hash: string }>();

		expect(redeem1!.status).toBe(RedeemRequestStatus.Confirming);
		expect(redeem1!.btc_block_height).toBe(100);
		expect(redeem1!.btc_block_hash).toBe("blockhash123");

		expect(redeem2!.status).toBe(RedeemRequestStatus.Confirming);
		expect(redeem2!.btc_block_height).toBe(100);
		expect(redeem2!.btc_block_hash).toBe("blockhash123");
	});

	it("getConfirmingRedeems should return redeems with confirming status", async () => {
		await insertRedeemRequest(storage, 1, "redeemer1", recipientScript, 3000, 1000, "0xSuiTx1");
		await insertRedeemRequest(storage, 2, "redeemer1", recipientScript, 5000, 2000, "0xSuiTx2");

		await storage.markRedeemBroadcasted(1, "btc_tx_1");
		await storage.markRedeemBroadcasted(2, "btc_tx_2");
		await storage.confirmRedeem(["btc_tx_1"], 100, "blockhash123");

		const confirming = await storage.getConfirmingRedeems("regtest");

		expect(confirming.length).toBe(1);
		expect(confirming[0]!.redeem_id).toBe(1);
		expect(confirming[0]!.btc_tx).toBe("btc_tx_1");
		expect(confirming[0]!.btc_block_height).toBe(100);
		expect(confirming[0]!.btc_block_hash).toBe("blockhash123");
		expect(confirming[0]!.btc_network).toBe("regtest");
	});

	it("getBroadcastedBtcRedeemTxIds should return txs with Broadcasting/Confirming/Reorg statuses", async () => {
		await insertRedeemRequest(storage, 1, "redeemer1", recipientScript, 3000, 1000, "0xSuiTx1");
		await insertRedeemRequest(storage, 2, "redeemer1", recipientScript, 5000, 2000, "0xSuiTx2");
		await insertRedeemRequest(storage, 3, "redeemer1", recipientScript, 7000, 3000, "0xSuiTx3");
		await insertRedeemRequest(storage, 4, "redeemer1", recipientScript, 9000, 4000, "0xSuiTx4");

		await storage.markRedeemBroadcasted(1, "btc_tx_1");
		await storage.markRedeemBroadcasted(2, "btc_tx_2");
		await storage.markRedeemBroadcasted(3, "btc_tx_3");
		await storage.confirmRedeem(["btc_tx_2"], 100, "blockhash123");

		const txIds = await storage.getBroadcastedBtcRedeemTxIds("regtest");

		expect(txIds.length).toBe(3);
		expect(txIds).toContain("btc_tx_1");
		expect(txIds).toContain("btc_tx_2");
		expect(txIds).toContain("btc_tx_3");
	});

	it("setRedeemFinalized should update redeem and mark UTXOs as spent", async () => {
		await insertRedeemRequest(storage, 1, "redeemer1", recipientScript, 3000, 1000, "0xSuiTx1");
		await insertUtxo(
			storage,
			1,
			scriptPubkey1,
			"dwallet1",
			"tx1",
			0,
			2000,
			UtxoStatus.Locked,
			null,
		);
		await storage.saveRedeemInputs([
			{
				redeem_id: 1,
				utxo_id: 1,
				input_index: 0,
				dwallet_id: "dwallet1",
				created_at: Date.now(),
			},
		]);

		await storage.setRedeemFinalized(1);

		const redeem = await db
			.prepare("SELECT status FROM nbtc_redeem_requests WHERE redeem_id = ?")
			.bind(1)
			.first<{ status: string }>();
		expect(redeem!.status).toBe(RedeemRequestStatus.Finalized);

		const utxo = await db
			.prepare("SELECT status FROM nbtc_utxos WHERE nbtc_utxo_id = ?")
			.bind(1)
			.first<{ status: string }>();
		expect(utxo!.status).toBe(UtxoStatus.Spent);
	});

	it("getRedeemUtxosWithDetails should return UTXOs with input_index", async () => {
		await insertRedeemRequest(storage, 1, "redeemer1", recipientScript, 5000, 1000, "0xSuiTx1");
		await insertUtxo(
			storage,
			1,
			scriptPubkey1,
			"dwallet1",
			"tx1",
			0,
			2000,
			UtxoStatus.Available,
			null,
		);
		await insertUtxo(
			storage,
			2,
			scriptPubkey1,
			"dwallet1",
			"tx2",
			0,
			3000,
			UtxoStatus.Available,
			null,
		);
		await storage.saveRedeemInputs([
			{
				redeem_id: 1,
				utxo_id: 2,
				input_index: 0,
				dwallet_id: "dwallet1",
				created_at: Date.now(),
			},
			{
				redeem_id: 1,
				utxo_id: 1,
				input_index: 1,
				dwallet_id: "dwallet1",
				created_at: Date.now(),
			},
		]);

		const utxos = await storage.getRedeemUtxosWithDetails(1);

		expect(utxos.length).toBe(2);
		expect(utxos[0]!.nbtc_utxo_id).toBe(2);
		expect(utxos[0]!.input_index).toBe(0);
		expect(utxos[1]!.nbtc_utxo_id).toBe(1);
		expect(utxos[1]!.input_index).toBe(1);
	});

	it("upsertRedeemInputs should insert new inputs and ignore conflicts", async () => {
		await insertRedeemRequest(storage, 1, "redeemer1", recipientScript, 5000, 1000, "0xSuiTx1");
		await insertUtxo(
			storage,
			1,
			scriptPubkey1,
			"dwallet1",
			"tx1",
			0,
			2000,
			UtxoStatus.Available,
			null,
		);
		await insertUtxo(
			storage,
			2,
			scriptPubkey1,
			"dwallet1",
			"tx2",
			0,
			3000,
			UtxoStatus.Available,
			null,
		);

		await storage.upsertRedeemInputs(1, [1, 2], ["dwallet1", "dwallet1"]);

		const inputs = await storage.getRedeemInputs(1);
		expect(inputs.length).toBe(2);
		expect(inputs[0]!.utxo_id).toBe(1);
		expect(inputs[1]!.utxo_id).toBe(2);

		// Try to insert again - should ignore due to conflict
		await storage.upsertRedeemInputs(1, [1], ["dwallet1"]);
		const inputsAgain = await storage.getRedeemInputs(1);
		expect(inputsAgain.length).toBe(2); // Still 2, not 3
	});

	it("markRedeemInputVerified should update input and conditionally update request", async () => {
		await insertRedeemRequest(storage, 1, "redeemer1", recipientScript, 5000, 1000, "0xSuiTx1");
		await insertUtxo(
			storage,
			1,
			scriptPubkey1,
			"dwallet1",
			"tx1",
			0,
			2000,
			UtxoStatus.Available,
			null,
		);
		await insertUtxo(
			storage,
			2,
			scriptPubkey1,
			"dwallet1",
			"tx2",
			0,
			3000,
			UtxoStatus.Available,
			null,
		);
		await storage.markRedeemSigning(1);
		await storage.saveRedeemInputs([
			{
				redeem_id: 1,
				utxo_id: 1,
				input_index: 0,
				dwallet_id: "dwallet1",
				created_at: Date.now(),
			},
			{
				redeem_id: 1,
				utxo_id: 2,
				input_index: 1,
				dwallet_id: "dwallet1",
				created_at: Date.now(),
			},
		]);

		await storage.markRedeemInputVerified(1, 1);
		let redeem = await db
			.prepare("SELECT status FROM nbtc_redeem_requests WHERE redeem_id = ?")
			.bind(1)
			.first<{ status: string }>();
		expect(redeem!.status).toBe(RedeemRequestStatus.Signing);

		await storage.markRedeemInputVerified(1, 2);
		redeem = await db
			.prepare("SELECT status FROM nbtc_redeem_requests WHERE redeem_id = ?")
			.bind(1)
			.first<{ status: string }>();
		expect(redeem!.status).toBe(RedeemRequestStatus.Signed);
	});

	it("clearRedeemInputSignId should set sign_id to null", async () => {
		await insertRedeemRequest(storage, 1, "redeemer1", recipientScript, 3000, 1000, "0xSuiTx1");
		await insertUtxo(
			storage,
			1,
			scriptPubkey1,
			"dwallet1",
			"tx1",
			0,
			2000,
			UtxoStatus.Available,
			null,
		);
		await storage.saveRedeemInputs([
			{
				redeem_id: 1,
				utxo_id: 1,
				input_index: 0,
				dwallet_id: "dwallet1",
				created_at: Date.now(),
			},
		]);
		await storage.updateRedeemInputSig(1, 1, "signId123");

		await storage.clearRedeemInputSignId(1, 1);

		const inputs = await storage.getRedeemInputs(1);
		expect(inputs[0]!.sign_id).toBeNull();
	});

	it("getRedeemInfoBySignId should return redeem info with setup data", async () => {
		await insertRedeemRequest(storage, 1, "redeemer1", recipientScript, 3000, 1000, "0xSuiTx1");
		await insertUtxo(
			storage,
			1,
			scriptPubkey1,
			"dwallet1",
			"tx1",
			0,
			2000,
			UtxoStatus.Available,
			null,
		);
		await storage.saveRedeemInputs([
			{
				redeem_id: 1,
				utxo_id: 1,
				input_index: 0,
				dwallet_id: "dwallet1",
				created_at: Date.now(),
			},
		]);
		await storage.updateRedeemInputSig(1, 1, "signId123");

		const info = await storage.getRedeemInfoBySignId("signId123");

		expect(info).not.toBeNull();
		expect(info!.redeem_id).toBe(1);
		expect(info!.utxo_id).toBe(1);
		expect(info!.input_index).toBe(0);
		expect(info!.nbtc_pkg).toBe("0xPkg1");
		expect(info!.sui_network).toBe(toSuiNet("devnet"));
	});
});
