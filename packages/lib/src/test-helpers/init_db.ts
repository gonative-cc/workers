import * as path from "path";
import { readdir } from "fs/promises";
import { D1Database } from "@cloudflare/workers-types";

// Loads all migration files into database
export async function applyMigrations(db: D1Database, migrationsPath: string) {
	const migrationFiles = await readdir(migrationsPath);
	migrationFiles.sort();

	for (const filename of migrationFiles) {
		if (filename.endsWith(".sql")) {
			const file = Bun.file(path.join(migrationsPath, filename));
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
