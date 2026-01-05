import * as path from "path";
import { D1Database } from "@cloudflare/workers-types";
import { applyMigrations } from "@gonative-cc/lib/test-helpers/init_db";

const MIGRATIONS_PATH = path.resolve(__dirname, "../db/migrations");

export async function initDb(db: D1Database) {
	await applyMigrations(db, MIGRATIONS_PATH);
}
