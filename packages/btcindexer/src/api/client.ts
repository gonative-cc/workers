import { PutBlocks, PutBlocksReq } from "./put-blocks";

export enum RestPath {
	blocks = "/bitcoin/blocks",
	nbtcTx = "/nbtc",
	latestHeight = "/bitcoin/latest-height",
}

export enum ContentType {
	msgpack = "application/vnd.msgpack",
}

const msgPackHeaders = {
	"Content-Type": ContentType.msgpack,
};

export default class Client {
	baseUrl: string;
	bearerToken?: string;

	constructor(baseUrl: string, bearerToken?: string) {
		if (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);

		this.baseUrl = baseUrl;
		this.bearerToken = bearerToken;
	}

	private getHeaders(additionalHeaders: Record<string, string> = {}): Record<string, string> {
		const headers = { ...additionalHeaders };
		if (this.bearerToken) {
			headers.Authorization = `Bearer ${this.bearerToken}`;
		}
		return headers;
	}

	async putBlocks(putBlocks: PutBlocks[]) {
		return fetch(this.baseUrl + RestPath.blocks, {
			method: "PUT",
			headers: this.getHeaders(msgPackHeaders),
			body: PutBlocksReq.encode(putBlocks),
		});
	}

	async getLatestHeight(): Promise<{ height: number | null }> {
		const response = await fetch(this.baseUrl + RestPath.latestHeight);
		if (!response.ok) {
			throw new Error(`Failed to fetch latest height: ${response.statusText}`);
		}
		return response.json();
	}

	async postNbtcTx(
		txHex: string,
	): Promise<{ success: boolean; tx_id: string; registered_deposits: number }> {
		const response = await fetch(this.baseUrl + RestPath.nbtcTx, {
			method: "POST",
			headers: this.getHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify({ txHex }),
		});
		if (!response.ok) {
			throw new Error(`Failed to post nBTC transaction: ${response.statusText}`);
		}
		return response.json();
	}
}
