export enum SanctionChains {
	Bitcoin = 0,
	Sui = 1,
}

export class D1Storage {
	constructor(private db: D1Database) {}

	async isAnyBtcAddressSanctioned(btcAddresses: string[]): Promise<boolean> {
		if (btcAddresses.length === 0) return false;

		// TODO: consider caching
		const BATCH_SIZE = 100;
		for (let i = 0; i < btcAddresses.length; i += BATCH_SIZE) {
			const chunk = btcAddresses.slice(i, i + BATCH_SIZE);
			const placeholders = chunk.map(() => "?").join(",");
			const query = `
			SELECT EXISTS (
			  SELECT 1 FROM sanctioned_addresses
			  WHERE address IN (${placeholders}) AND chain = ${SanctionChains.Bitcoin}
			) as sanctioned;`;
			const result = await this.db
				.prepare(query)
				.bind(...chunk)
				.first<{ sanctioned: number }>();

			if (result?.sanctioned) {
				return true;
			}
		}

		return false;
	}

	async insertSanctionnedAddrs(addrs: string[], chain: SanctionChains) {
		if (addrs.length === 0) return;
		const placeholders = addrs.map(() => `(?, ${chain})`).join(", ");
		const query = `INSERT INTO sanctioned_addresses (address, chain) VALUES ${placeholders}`;

		return this.db
			.prepare(query)
			.bind(...addrs)
			.run();
	}
}
