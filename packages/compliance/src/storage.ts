import { logError } from "@gonative-cc/lib/logger";

export class D1Storage {
	constructor(private db: D1Database) {}

	async isBtcBlocked(btcAddresses: string[]): Promise<Record<string, boolean>> {
		try {
			const placeholders = btcAddresses.map(() => "?").join(",");
			const results = await this.db
				.prepare(
					`SELECT address FROM sanctioned_addresses WHERE address IN (${placeholders}) AND chain = 0`,
				)
				.bind(...btcAddresses)
				.all<{ address: string }>();
			const blockedSet = new Set(results.results?.map((r) => r.address) || []);
			return Object.fromEntries(btcAddresses.map((addr) => [addr, blockedSet.has(addr)]));
		} catch (e) {
			logError(
				{
					method: "isBtcBlocked",
					msg: "Failed to check sanctions",
					btcAddress: btcAddresses,
				},
				e,
			);
			throw e;
		}
	}
}
