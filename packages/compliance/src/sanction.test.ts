import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Miniflare } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { applyMigrations } from "@gonative-cc/lib/test-helpers/init_db";
import * as path from "path";
import { processLine, insertSanctionedAddresses } from "./sanction";

let mf: Miniflare;
let db: D1Database;

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
	db = await mf.getD1Database("DB");
	const migrationsPath = path.resolve(__dirname, "../db/migrations");
	await applyMigrations(db, migrationsPath);
});

describe("processLine", () => {
	it("should parse and categorize BTC addresses", () => {
		const btcAddresses: string[] = [];
		const suiAddresses: string[] = [];
		const line = JSON.stringify({
			properties: {
				cryptoWallets: [
					{ properties: { currency: ["XBT"], publicKey: ["1BTC_TEST_ADDR"] } },
				],
			},
		});

		processLine(line, btcAddresses, suiAddresses);

		expect(btcAddresses).toEqual(["1BTC_TEST_ADDR"]);
		expect(suiAddresses).toEqual([]);
	});

	it("should parse and categorize SUI addresses", () => {
		const btcAddresses: string[] = [];
		const suiAddresses: string[] = [];
		const line = JSON.stringify({
			properties: {
				cryptoWallets: [
					{ properties: { currency: ["SUI"], publicKey: ["0xSUI_TEST_ADDR"] } },
				],
			},
		});

		processLine(line, btcAddresses, suiAddresses);

		expect(btcAddresses).toEqual([]);
		expect(suiAddresses).toEqual(["0xSUI_TEST_ADDR"]);
	});

	it("should ignore non-BTC/SUI currencies", () => {
		const btcAddresses: string[] = [];
		const suiAddresses: string[] = [];
		const line = JSON.stringify({
			properties: {
				cryptoWallets: [
					{ properties: { currency: ["ETH"], publicKey: ["0xETH_IGNORED"] } },
				],
			},
		});

		processLine(line, btcAddresses, suiAddresses);

		expect(btcAddresses).toEqual([]);
		expect(suiAddresses).toEqual([]);
	});

	it("should handle empty lines", () => {
		const btcAddresses: string[] = [];
		const suiAddresses: string[] = [];

		processLine("", btcAddresses, suiAddresses);
		processLine("   ", btcAddresses, suiAddresses);

		expect(btcAddresses).toEqual([]);
		expect(suiAddresses).toEqual([]);
	});
});

describe("insertSanctionedAddresses", () => {
	it("should insert BTC and SUI addresses with correct chain IDs", async () => {
		await insertSanctionedAddresses(db, ["1BTC_TEST_ADDR"], ["0xSUI_TEST_ADDR"]);

		const btcRecord = await db
			.prepare("SELECT * FROM sanctioned_addresses WHERE chain = 0")
			.first();
		expect(btcRecord?.address).toBe("1BTC_TEST_ADDR");

		const suiRecord = await db
			.prepare("SELECT * FROM sanctioned_addresses WHERE chain = 1")
			.first();
		expect(suiRecord?.address).toBe("0xSUI_TEST_ADDR");
	});

	it("should replace existing records", async () => {
		await db
			.prepare("INSERT INTO sanctioned_addresses (address, chain) VALUES (?, ?)")
			.bind("old_address", 0)
			.run();

		await insertSanctionedAddresses(db, ["new_address"], []);

		const oldRecord = await db
			.prepare("SELECT * FROM sanctioned_addresses WHERE address = 'old_address'")
			.first();
		expect(oldRecord).toBeNull();

		const newRecord = await db
			.prepare("SELECT * FROM sanctioned_addresses WHERE address = 'new_address'")
			.first();
		expect(newRecord).not.toBeNull();
	});

	it("should handle empty address lists", async () => {
		await insertSanctionedAddresses(db, [], []);

		const { results } = await db.prepare("SELECT * FROM sanctioned_addresses").all();
		expect(results.length).toBe(0);
	});
});
