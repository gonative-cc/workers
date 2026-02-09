import * as path from "path";
import { readdir } from "fs/promises";
import { D1Database } from "@cloudflare/workers-types";
import assert from "assert";

// Loads all migration files into database
export async function applyMigrations(db: D1Database, migrationsPath: string) {
	const migrationFiles = await readdir(migrationsPath);
	migrationFiles.sort();

	for (const filename of migrationFiles) {
		if (filename.endsWith(".sql")) {
			const file = Bun.file(path.join(migrationsPath, filename));
			const migration = await file.text();
			// we need to put each statement in a single line
			const cleanedMigration = migration
				.replace(/--.*/g, "")
				.replace(/\n/g, " ")
				.replace(/\s{2,}/g, " ")
				// separate each statement in a new line to have a correct result.count
				.replace(/;/g, "\n")
				.trim();
			assert(cleanedMigration.length > 0, "empty migration: " + filename);

			const result = await db.exec(cleanedMigration);

			const numCreate = cleanedMigration.match(/\bcreate\b/gi)?.length || 0;
			assert(result.count > 0, "migrations execution failed");
			assert(result.count === numCreate, "migrations execution failed");
		}
	}
}

const MIGRATIONS_PATH = path.resolve(__dirname, "../../../btcindexer/db/migrations");
// NOTE: Drop tables in correct order: child tables first to avoid foreign key constraints
export const tables = [
	"nbtc_redeem_solutions",
	"nbtc_utxos",
	"nbtc_redeem_requests",
	"nbtc_minting",
	"nbtc_deposit_addresses",
	"btc_blocks",
	"indexer_state",
	"presign_objects",
	"cron_locks",
	"setups",
];

export async function initDb(db: D1Database) {
	return applyMigrations(db, MIGRATIONS_PATH);
}

export function dropTables(db: D1Database) {
	const dropStms = tables.map((t) => `DROP TABLE IF EXISTS ${t};`).join(" ");
	return db.exec(dropStms);
}
