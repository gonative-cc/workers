import { PutBlock, PutBlocksReq } from "./put-blocks";

export const RestPath = {
	blocks: "/",
};

export enum ContentType {
	MSG_PACK = "application/vnd.msgpack",
}

const msgPackHeaders = {
	"Content-Type": ContentType.MSG_PACK,
};

export class BtcIndexerClient {
	#url: string;
	constructor(url: string) {
		this.#url = url;
	}

	async putBlocks(blocks: PutBlock[]): Promise<void> {
		const req = PutBlocksReq.encode(blocks);
		const res = await fetch(this.#url + RestPath.blocks, {
			method: "POST",
			headers: msgPackHeaders,
			body: req,
		});
		if (!res.ok) {
			throw new Error(`Failed to put blocks: ${res.statusText}`);
		}
	}
}
