import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { Miniflare } from "miniflare";
import { D1Storage } from "./storage";
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

describe("Bitcoin compliance", () => {
	let storage: D1Storage;
	let db: D1Database;

	beforeEach(async () => {
		db = await mf.getD1Database("DB");
		await initDb(db);

		storage = new D1Storage(db);
	});

	afterEach(() => dropTables(db));

	test("should detect sanctioned bitcoin addresses", async () => {
		expect(await storage.isBtcBlocked([])).toBeFalse();
	});
});
