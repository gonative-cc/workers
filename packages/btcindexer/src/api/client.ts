import { PutBlocks, PutBlocksReq } from "./put-blocks";

export enum RestPath {
	blocks = "/bitcoin/blocks",
	nbtcTx = "/nbtc",
	transactions = "/transactions",
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
}
