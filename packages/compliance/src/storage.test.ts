import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { Miniflare } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { applyMigrations, purgeTables } from "@gonative-cc/lib/test-helpers/init_db";
import * as path from "path";
import { D1Storage, SanctionChains } from "./storage";

let mf: Miniflare;
let db: D1Database;
let storage: D1Storage;

beforeAll(async () => {
	mf = new Miniflare({
		script: "",
		modules: true,
		d1Databases: ["DB"],
		d1Persist: false,
	});
	db = await mf.getD1Database("DB");
	const migrationsPath = path.resolve(__dirname, "../db/migrations");
	await applyMigrations(db, migrationsPath);
	storage = new D1Storage(db);
});

afterAll(async () => {
	await mf.dispose();
});

afterEach(async () => {
	return purgeTables(db, ["sanctioned_addresses"]);
});

describe("isBtcBlocked", () => {
	it("should return false for all addresses when none are blocked", async () => {
		const result = await storage.isAnyBtcAddressSanctioned(["addr1", "addr2"]);
		expect(result).toEqual(false);
	});

	it("should return false if one of the addresses is sanctioned", async () => {
		await storage.insertSanctionnedAddrs(["b1"], SanctionChains.Bitcoin);
		const result = await storage.isAnyBtcAddressSanctioned(["b1", "clean"]);
		expect(result).toEqual(true);
	});

	it("should handle multiple blocked addresses", async () => {
		await storage.insertSanctionnedAddrs(["b1", "b2"], SanctionChains.Bitcoin);

		let result = await storage.isAnyBtcAddressSanctioned(["b1", "b2", "a3"]);
		expect(result).toEqual(true);

		result = await storage.isAnyBtcAddressSanctioned(["a3"]);
		expect(result).toEqual(false);

		result = await storage.isAnyBtcAddressSanctioned(["a3", "a5"]);
		expect(result).toEqual(false);

		result = await storage.isAnyBtcAddressSanctioned(["a3", "b1"]);
		expect(result).toEqual(true);
	});

	it("should handle empty address list", async () => {
		const result = await storage.isAnyBtcAddressSanctioned([]);
		expect(result).toEqual(false);
	});
});
