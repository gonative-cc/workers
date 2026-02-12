import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Miniflare } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { applyMigrations } from "@gonative-cc/lib/test-helpers/init_db";
import * as path from "path";
import { D1Storage } from "./storage";

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
});

afterAll(async () => {
	await mf.dispose();
});

beforeEach(async () => {
	db = await mf.getD1Database("DB");
	const migrationsPath = path.resolve(__dirname, "../db/migrations");
	await applyMigrations(db, migrationsPath);
	storage = new D1Storage(db);
});

describe("isBtcBlocked", () => {
	it("should return false for all addresses when none are blocked", async () => {
		const result = await storage.isBtcBlocked(["addr1", "addr2"]);
		expect(result).toEqual({ addr1: false, addr2: false });
	});

	it("should return true for blocked addresses", async () => {
		await db
			.prepare("INSERT INTO sanctioned_addresses (address, chain) VALUES (?, ?)")
			.bind("blocked_addr", 0)
			.run();
		const result = await storage.isBtcBlocked(["blocked_addr", "clean_addr"]);
		expect(result).toEqual({ blocked_addr: true, clean_addr: false });
	});

	it("should handle multiple blocked addresses", async () => {
		await db
			.prepare("INSERT INTO sanctioned_addresses (address, chain) VALUES (?, ?), (?, ?)")
			.bind("addr1", 0, "addr2", 0)
			.run();
		const result = await storage.isBtcBlocked(["addr1", "addr2", "addr3"]);
		expect(result).toEqual({ addr1: true, addr2: true, addr3: false });
	});

	it("should handle empty address list", async () => {
		const result = await storage.isBtcBlocked([]);
		expect(result).toEqual({});
	});
});
