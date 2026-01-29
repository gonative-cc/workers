import { $ } from "bun"; // this for running the shell commands
import { SETUPS, type EnvName } from "./config";

main().catch((err) => {
	console.error("Error seeding addresses:", err);
	process.exit(1);
});

async function main() {
	const args = process.argv.slice(2);
	const local = args.includes("--local");

	let env: EnvName | undefined;
	if (args.includes("prod")) env = "prod";
	else if (args.includes("backstage")) env = "backstage";
	else if (args.includes("dev")) env = "dev";

	if (!env) {
		console.error(
			"No environment specified, Usage: bun scripts/seed-config.ts [dev|backstage|prod] [--local]",
		);
		return;
	}

	const config = SETUPS[env];
	if (!config) {
		console.error(`No configuration found for environment: ${env}`);
		return;
	}

	const DB_NAME = config.db_name;
	console.log(`Using environment: ${env}, DB: ${DB_NAME}`);

	if (!config.setups || config.setups.length === 0) {
		console.log("No packages to seed.");
		return;
	}

	for (const entry of config.setups) {
		if (
			!entry.btc_network ||
			!entry.sui_network ||
			!entry.nbtc_pkg ||
			!entry.nbtc_contract ||
			!entry.lc_pkg ||
			!entry.lc_contract ||
			!entry.nbtc_fallback_addr ||
			!entry.btc_address
		) {
			console.error("Invalid entry (missing fields)");
			continue;
		}

		const checkSetupRowQuery = `SELECT id FROM setups WHERE btc_network = '${entry.btc_network}' AND sui_network = '${entry.sui_network}' AND nbtc_pkg = '${entry.nbtc_pkg}'`;
		let setupId = await executeQuery<number>(checkSetupRowQuery, DB_NAME, local, "id");
		if (!setupId) {
			const insertPkgQuery = `
				INSERT INTO setups (btc_network, sui_network, nbtc_pkg, nbtc_contract, lc_pkg, lc_contract, nbtc_fallback_addr)
				VALUES ('${entry.btc_network}', '${entry.sui_network}', '${entry.nbtc_pkg}', '${entry.nbtc_contract}', '${entry.lc_pkg}', '${entry.lc_contract}', '${entry.nbtc_fallback_addr}')
				RETURNING id
			`;
			setupId = await executeQuery<number>(insertPkgQuery, DB_NAME, local, "id");
		}

		if (!setupId) {
			console.error("Failed to get setup ID for entry");
			continue;
		}

		const checkAddrQuery = `SELECT 1 as "exists" FROM nbtc_deposit_addresses WHERE setup_id = ${setupId} AND deposit_address = '${entry.btc_address}'`;
		const existingAddrId = await executeQuery<number>(checkAddrQuery, DB_NAME, local, "id");

		if (existingAddrId) {
			continue;
		}

		const insertAddrQuery = `INSERT INTO nbtc_deposit_addresses (setup_id, deposit_address) VALUES (${setupId}, '${entry.btc_address}')`;
		await executeQuery(insertAddrQuery, DB_NAME, local);
	}
}

async function executeQuery<T>(
	query: string,
	dbName: string,
	local: boolean,
	field?: string,
): Promise<T | null> {
	const cmd = ["bun", "wrangler", "d1", "execute", dbName, `--command="${query}"`, "--json"];
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
