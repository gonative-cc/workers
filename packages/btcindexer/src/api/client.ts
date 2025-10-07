import { NbtcTxStatusResp } from "../models";
import { PutBlocks, PutBlocksReq } from "./put-blocks";

export enum RestPath {
	blocks = "/bitcoin/blocks",
	nbtcTx = "/nbtc",
	latestHeight = "/bitcoin/latest-height",
	depositsBySender = "/bitcoin/sender/:address/deposits",
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

	async postNbtcTx(
		txHex: string,
	): Promise<{ success: boolean; tx_id: string; registered_deposits: number }> {
		const response = await fetch(this.baseUrl + RestPath.nbtcTx, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ txHex }),
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`Failed to post nBTC transaction: ${response.statusText} - ${errorBody}`,
			);
		}
		return response.json();
	}

	async getStatusByBtcTxId(txid: string): Promise<NbtcTxStatusResp | null> {
		const url = `${this.baseUrl}${RestPath.nbtcTx}/${txid}`;
		const response = await fetch(url);
		if (response.status === 404) {
			return null;
		}
		if (!response.ok) {
			throw new Error(`Failed to get status by BTC txid: ${response.statusText}`);
		}
		return response.json();
	}

	async getStatusBySuiAddress(suiAddress: string): Promise<NbtcTxStatusResp[]> {
		const url = new URL(this.baseUrl + RestPath.nbtcTx);
		url.searchParams.append("sui_recipient", suiAddress);

		const response = await fetch(url.toString());
		if (!response.ok) {
			throw new Error(`Failed to get status by Sui address: ${response.statusText}`);
		}
		return response.json();
	}
}
