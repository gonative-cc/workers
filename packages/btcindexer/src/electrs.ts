import type { BtcNet } from "@gonative-cc/lib/nbtc";

export type GlobalFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const ELECTRS_URLS_BY_NETWORK: Record<BtcNet, string | undefined> = {
	mainnet: undefined,
	testnet: undefined,
	regtest: "http://localhost:8080/regtest/api",
	signet: undefined,
};

export interface Electrs {
	getTx: (txId: string) => Promise<Response>;
}

export class ElectrsService implements Electrs {
	baseUrl: string;

	constructor(baseUrl: string) {
		if (!baseUrl.endsWith("/")) baseUrl += "/";
		this.baseUrl = baseUrl;
	}

	async getTx(txId: string) {
		return fetch(this.baseUrl + "/tx/" + txId);
	}
}
