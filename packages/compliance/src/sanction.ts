import { logError, logger } from "@gonative-cc/lib/logger";
import { StringDecoder } from "string_decoder";

interface WalletEntity {
	properties: {
		currency: string[];
		publicKey: string[];
	};
}

interface SanctionEntity {
	properties: {
		cryptoWallets?: WalletEntity[];
	};
}

const SANCTIONS_DATASET_URL =
	"https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.nested.json";
const BATCH_SIZE = 100;

// Helper to process a single entity line
export function processLine(line: string, btcAddresses: string[], suiAddresses: string[]) {
	if (!line.trim()) return;
	const entity: SanctionEntity = JSON.parse(line);

	if (entity.properties?.cryptoWallets) {
		for (const wallet of entity.properties?.cryptoWallets || []) {
			const currency = wallet.properties.currency?.[0]?.toUpperCase();
			const address = wallet.properties.publicKey?.[0];

			if (!currency || !address) continue;

			if (currency === "XBT") btcAddresses.push(address);
			if (currency === "SUI") suiAddresses.push(address);
		}
	}
}

async function querySanctionedAddresses(): Promise<{
	btcAddresses: string[];
	suiAddresses: string[];
}> {
	logger.debug({ msg: "Downloading and processing..." });

	const response = await fetch(SANCTIONS_DATASET_URL);
	if (!response.ok) {
		throw new Error(
			`Failed to fetch sanctions dataset: ${response.status} ${response.statusText}`,
		);
	}
	if (!response.body) throw new Error("No response body");

	const btcAddresses: string[] = [];
	const suiAddresses: string[] = [];
	const decoder = new StringDecoder("utf8");
	let buffer = "";

	const reader = response.body.getReader();

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.write(Buffer.from(value));
		const lines = buffer.split("\n");
		buffer = lines.pop() || "";

		for (const line of lines) {
			processLine(line, btcAddresses, suiAddresses);
		}
	}

	if (buffer.trim()) processLine(buffer, btcAddresses, suiAddresses);

	logger.debug({
		msg: `Found ${btcAddresses.length} BTC and ${suiAddresses.length} SUI addresses.`,
	});

	return { btcAddresses, suiAddresses };
}

export async function insertSanctionedAddresses(
	db: D1Database,
	btcAddresses: string[],
	suiAddresses: string[],
) {
	const allStatements: D1PreparedStatement[] = [];

	btcAddresses.forEach((addr) => {
		allStatements.push(
			db
				.prepare(
					"INSERT OR IGNORE INTO sanctioned_addresses (address, chain) VALUES (?, ?)",
				)
				.bind(addr, 0),
		);
	});

	suiAddresses.forEach((addr) => {
		allStatements.push(
			db
				.prepare(
					"INSERT OR IGNORE INTO sanctioned_addresses (address, chain) VALUES (?, ?)",
				)
				.bind(addr, 1),
		);
	});

	await db.prepare("DELETE FROM sanctioned_addresses").run();

	for (let i = 0; i < allStatements.length; i += BATCH_SIZE) {
		const batch = allStatements.slice(i, i + BATCH_SIZE);
		await db.batch(batch);
	}

	logger.debug({
		msg: `Database updated successfully with ${allStatements.length} addresses.`,
	});
}

export async function updateSanctionedAddress(db: D1Database) {
	try {
		const { btcAddresses, suiAddresses } = await querySanctionedAddresses();
		await insertSanctionedAddresses(db, btcAddresses, suiAddresses);
	} catch (err) {
		const error = err as Error;
		logError(
			{
				method: "processSanctionedAddress",
				msg: error.message || "Error processing sanctioned address",
			},
			err,
		);
		throw err;
	}
}
