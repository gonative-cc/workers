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

const URL = "https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.nested.json";

export async function processSanctionedAddress(env: Env) {
	try {
		logger.debug({ msg: "Downloading and processing..." });

		const response = await fetch(URL);
		if (!response.body) throw new Error("No response body");

		const btcAddresses: string[] = [];
		const suiAddresses: string[] = [];
		const decoder = new StringDecoder("utf8");
		let buffer = "";

		// Helper to process a single entity line
		const processLine = (line: string) => {
			if (!line.trim()) return;
			const entity: SanctionEntity = JSON.parse(line);

			if (entity.properties?.cryptoWallets) {
				for (const wallet of entity.properties.cryptoWallets) {
					const currency = wallet.properties.currency?.[0]?.toUpperCase();
					const address = wallet.properties.publicKey?.[0];

					if (!currency || !address) continue;

					if (currency === "XBT") btcAddresses.push(address);
					if (currency === "SUI") suiAddresses.push(address);
				}
			}
		};

		// Stream processing
		const reader = response.body.getReader();

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.write(Buffer.from(value));
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";

			for (const line of lines) {
				processLine(line);
			}
		}

		// Handle leftover buffer
		if (buffer.trim()) processLine(buffer);

		logger.debug({
			msg: `Found ${btcAddresses.length} BTC and ${suiAddresses.length} SUI addresses.`,
		});

		// --- Database Transaction (Batch) ---

		const statements: D1PreparedStatement[] = [
			env.DB.prepare("DELETE FROM SanctionedCryptoAddresses"),
		];

		// Add BTC inserts
		btcAddresses.forEach((addr) => {
			statements.push(
				env.DB.prepare(
					"INSERT OR IGNORE INTO SanctionedCryptoAddresses (wallet_address, address_type) VALUES (?, ?)",
				).bind(addr, "BTC"),
			);
		});

		// Add SUI inserts
		suiAddresses.forEach((addr) => {
			statements.push(
				env.DB.prepare(
					"INSERT INTO SanctionedCryptoAddresses (wallet_address, address_type) VALUES (?, ?)",
				).bind(addr, "SUI"),
			);
		});

		await env.DB.batch(statements);

		logger.debug({
			msg: `"Database updated successfully.`,
		});
	} catch (err) {
		const error = err as Error;
		logError({
			method: "processSanctionedAddress",
			msg: error.message || "Error processing sanctioned address",
		});
	}
}
