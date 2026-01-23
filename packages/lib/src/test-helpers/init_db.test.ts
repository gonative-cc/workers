import { test, expect, afterAll } from "bun:test";
import { Miniflare } from "miniflare";

import { dropTables, initDb, tables } from "./init_db";
import type { D1Database } from "@cloudflare/workers-types";

const mf = new Miniflare({
	script: "",
	modules: true,
	d1Databases: ["DB"],
	d1Persist: false,
});

async function selectTables(db: D1Database) {
	const { results } = await db
		.prepare(
			"SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_%METADATA'",
		)
		.all();
	return results;
}

test("initDB", async () => {
	const db = await mf.getD1Database("DB");
	await initDb(db);

	const allTables = await selectTables(db);
	const tableNames = allTables.map((row) => row.name);
	const tableNamesStr = "created tables: " + JSON.stringify(tableNames);
	expect(tableNames.length, tableNamesStr).toBeGreaterThanOrEqual(tables.length);
	expect(tableNames).toContain("setups");
	expect(tableNames).toContain("indexer_state");

	await dropTables(db);
	expect(await selectTables(db)).toBeEmpty();
});

afterAll(async () => {
	await mf.dispose();
});
