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

	constructor(baseUrl: string) {
		if (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);

		this.baseUrl = baseUrl;
	}

	async putBlocks(putBlocks: PutBlocks[]) {
		return fetch(this.baseUrl + RestPath.blocks, {
			method: "PUT",
			headers: msgPackHeaders,
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
}
