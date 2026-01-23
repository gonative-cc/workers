import { test, expect, afterAll } from "bun:test";
import { Miniflare } from "miniflare";

import { dropTables, initDb, tables } from "./init_db";

const mf = new Miniflare({
	script: "",
	modules: true,
	d1Databases: ["DB"],
	d1Persist: false,
});

test("initDB", async () => {
	const db = await mf.getD1Database("DB");
	await initDb(db);

	const { results } = await db
		.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
		.all();

	const tableNames = results.map((row) => row.name);
	const tableNamesStr = "created tables: " + JSON.stringify(tableNames);
	expect(tableNames.length, tableNamesStr).toBeGreaterThanOrEqual(tables.length);
	expect(tableNames).toContain("setups");
	expect(tableNames).toContain("indexer_state");
});

afterAll(async () => {
	await mf.dispose();
});
