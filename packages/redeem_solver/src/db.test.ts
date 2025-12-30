import * as path from "path";
import { D1Database } from "@cloudflare/workers-types";
import { initDb as initDbShared } from "@gonative-cc/lib/common-setup/db.test";

const MIGRATIONS_PATH = path.resolve(__dirname, "../../btcindexer/db/migrations");

export async function initDb(db: D1Database) {
	await initDbShared(db, MIGRATIONS_PATH);
}
