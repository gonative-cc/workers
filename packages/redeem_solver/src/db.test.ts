import * as path from "path";
import { readdir } from "fs/promises";
import { D1Database } from "@cloudflare/workers-types";

// Point to btcindexer's migrations since redeem_solver shares the same database schema
const MIGRATIONS_PATH = path.resolve(__dirname, "../../btcindexer/db/migrations");

export async function initDb(db: D1Database) {
	const migrationFiles = await readdir(MIGRATIONS_PATH);
	migrationFiles.sort();

	for (const filename of migrationFiles) {
		if (filename.endsWith(".sql")) {
			const file = Bun.file(path.join(MIGRATIONS_PATH, filename));
			const migration = await file.text();
			const cleanedMigration = migration
				.replace(/--.*/g, "")
				.replace(/\n/g, " ")
				.replace(/\s{2,}/g, " ")
				.trim();
			if (cleanedMigration.length > 0) {
				await db.exec(cleanedMigration);
			}
		}
	}
}
