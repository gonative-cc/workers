import { NbtcAddress } from "./models";
import { D1Database } from "@cloudflare/workers-types";

/**
 * Fetches all nBTC deposit addresses from the D1 database.
 * @param db The D1 database binding.
 * @returns A promise that resolves to an array of NbtcAddress objects.
 */
export async function fetchNbtcAddresses(db: D1Database): Promise<NbtcAddress[]> {
	const { results } = await db.prepare("SELECT * FROM nbtc_addresses").all<NbtcAddress>();
	return results || [];
}
