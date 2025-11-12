import { $ } from "bun"; // this for running the shell commands

const DB_NAME = "btcindexer-dev";
const ADDRESSES_FILE = "scripts/nbtc_addresses.json";

async function main() {
	const local = process.argv.includes("--local");

	const file = Bun.file(ADDRESSES_FILE);
	const addresses = JSON.parse(await file.text());

	if (!addresses || addresses.length === 0) {
		console.log("No addresses found");
		return;
	}

	for (const address of addresses) {
		const { btc_network, sui_network, nbtc_pkg, btc_address } = address;
		if (!btc_network || !sui_network || !nbtc_pkg || !btc_address) {
			console.error("Invalid entry:", address);
			continue;
		}

		const checkQuery = `SELECT * FROM nbtc_addresses WHERE btc_network = '${btc_network}' AND sui_network = '${sui_network}' AND btc_address = '${btc_address}'`;
		const checkCmd = [
			"bun",
			"wrangler",
			"d1",
			"execute",
			DB_NAME,
			`--command="${checkQuery}"`,
			"--json",
		];
		if (local) {
			checkCmd.push("--local");
		}
		const checkResult = await $`${checkCmd}`.quiet();
		const checkOutput = JSON.parse(checkResult.stdout.toString())[0];
		if (checkOutput.results && checkOutput.results.length > 0) {
			console.log("address already in db, skipping");
			continue;
		}

		const insertQuery = `INSERT INTO nbtc_addresses (btc_network, sui_network, nbtc_pkg, btc_address) VALUES ('${btc_network}', '${sui_network}', '${nbtc_pkg}', '${btc_address}')`;
		console.log(`Executing: ${insertQuery}`);
		const insertCmd = [
			"bun",
			"wrangler",
			"d1",
			"execute",
			DB_NAME,
			`--command="${insertQuery}"`,
		];

		if (local) {
			insertCmd.push("--local");
		}

		await $`${insertCmd}`.quiet();
	}
}

main().catch((err) => {
	console.error("Error seeding addresses:", err);
	process.exit(1);
});
