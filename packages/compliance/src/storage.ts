import { logError } from "@gonative-cc/lib/logger";

export class D1Storage {
	constructor(private db: D1Database) {}

	// returns true if any of the given btcAddrs is blocked
	async isBtcBlocked(btcAddrs: string[]): Promise<boolean> {
		// TODO: finish implementation
		return true;
	}
}
