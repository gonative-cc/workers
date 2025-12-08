import { $ } from "bun"; // this for running the shell commands
import { NBTC_PACKAGES } from "./config";

const DB_NAME = "btcindexer-dev"; // TODO: make sure to use the right name

main().catch((err) => {
	console.error("Error seeding addresses:", err);
	process.exit(1);
});

async function main() {
	const local = process.argv.includes("--local");

	if (!NBTC_PACKAGES || NBTC_PACKAGES.length === 0) {
		return;
	}

	for (const entry of NBTC_PACKAGES) {
		const {
			btc_network,
			sui_network,
			nbtc_pkg,
			nbtc_contract,
			lc_pkg,
			lc_contract,
			sui_fallback_address,
			btc_address,
		} = entry;
		if (
			!btc_network ||
			!sui_network ||
			!nbtc_pkg ||
			!nbtc_contract ||
			!lc_pkg ||
			!lc_contract ||
			!sui_fallback_address ||
			!btc_address
		) {
			console.error("Invalid entry (missing fields)");
			continue;
		}

		const checkPkgQuery = `SELECT id FROM nbtc_packages WHERE btc_network = '${btc_network}' AND sui_network = '${sui_network}' AND nbtc_pkg = '${nbtc_pkg}'`;
		let packageId = await executeQuery<number>(checkPkgQuery, local, "id");
		if (!packageId) {
			const insertPkgQuery = `
				INSERT INTO nbtc_packages (btc_network, sui_network, nbtc_pkg, nbtc_contract, lc_pkg, lc_contract, sui_fallback_address) 
				VALUES ('${btc_network}', '${sui_network}', '${nbtc_pkg}', '${nbtc_contract}', '${lc_pkg}', '${lc_contract}', '${sui_fallback_address}') 
				RETURNING id
			`;
			packageId = await executeQuery<number>(insertPkgQuery, local, "id");
		}

		if (!packageId) {
			console.error("Failed to get package ID for entry");
			continue;
		}

		const checkAddrQuery = `SELECT id FROM nbtc_deposit_addresses WHERE package_id = ${packageId} AND deposit_address = '${btc_address}'`;
		const existingAddrId = await executeQuery<number>(checkAddrQuery, local, "id");

		if (existingAddrId) {
			continue;
		}

		const insertAddrQuery = `INSERT INTO nbtc_deposit_addresses (package_id, deposit_address) VALUES (${packageId}, '${btc_address}')`;
		await executeQuery(insertAddrQuery, local);
	}
}

async function executeQuery<T>(query: string, local: boolean, field?: string): Promise<T | null> {
	const cmd = ["bun", "wrangler", "d1", "execute", DB_NAME, `--command="${query}"`, "--json"];
	if (local) {
		cmd.push("--local");
	}

	try {
		const result = await $`${cmd}`.quiet();
		const output = JSON.parse(result.stdout.toString())[0];

		if (output.results && output.results.length > 0) {
			if (field) {
				return output.results[0][field];
			}
			return output.results[0];
		}
		return null;
	} catch (e) {
		console.error(`Failed to execute query: ${query}`, e);
		return null;
	}
}
