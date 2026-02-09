import { type PutBlock, PutBlocksReq } from "./put-blocks";

export const RestPath = {
	blocks: "/bitcoin/blocks",
};

export enum ContentType {
	MSG_PACK = "application/msgpack",
}

export class BtcIndexerClient {
	#url: string;
	#authToken?: string;

	constructor(url: string, authToken?: string) {
		this.#url = url.endsWith("/") ? url.slice(0, -1) : url;
		this.#authToken = authToken;
	}

	async putBlocks(blocks: PutBlock[]): Promise<void> {
		const req = PutBlocksReq.encode(blocks);
		const headers: Record<string, string> = {
			"Content-Type": ContentType.MSG_PACK,
		};
		if (this.#authToken) {
			headers["Authorization"] = `Bearer ${this.#authToken}`;
		}

		const res = await fetch(this.#url + RestPath.blocks, {
			method: "PUT",
			headers,
			body: req,
		});
		if (!res.ok) {
			throw new Error(`Failed to put blocks: ${res.statusText}`);
		}
	}
}
