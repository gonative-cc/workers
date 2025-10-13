export type GlobalFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

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
