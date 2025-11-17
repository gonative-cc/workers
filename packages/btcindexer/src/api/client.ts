import { BitcoinNetwork } from "@gonative-cc/lib/bitcoin";
import { type TxStatusResp, type PostNbtcTxRequest } from "../models";

export const enum RestPath {
	latestHeight = "/height",
	nbtcTx = "/tx",
	depositsBySender = "/deposits/sender", // ?sender=address
}

export class BtcIndexerClient {
	#url: string;

	constructor(url: string) {
		this.#url = url.endsWith("/") ? url.slice(0, -1) : url;
	}

	async getLatestHeight(): Promise<{ height: number | null }> {
		const res = await fetch(this.#url + RestPath.latestHeight);
		if (!res.ok) {
			throw new Error(`Failed to fetch latest height: ${res.statusText}`);
		}
		return res.json();
	}

	async postNbtcTx(
		txHex: string,
		network: BitcoinNetwork,
	): Promise<{ success: boolean; tx_id: string; registered_deposits: number }> {
		const body: PostNbtcTxRequest = { txHex, network };
		const res = await fetch(this.#url + RestPath.nbtcTx, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			const errorBody = await res.text();
			throw new Error(`Failed to post nBTC transaction: ${res.statusText} - ${errorBody}`);
		}
		return res.json();
	}

	async getStatusByBtcTxId(txid: string): Promise<TxStatusResp | null> {
		const res = await fetch(`${this.#url}${RestPath.nbtcTx}/${txid}`);
		if (res.status === 404) {
			return null;
		}
		if (!res.ok) {
			throw new Error(`Failed to get status by BTC txid: ${res.statusText}`);
		}
		return res.json();
	}

	async getStatusBySuiAddress(suiRecipient: string): Promise<TxStatusResp[]> {
		const url = new URL(this.#url + RestPath.nbtcTx);
		url.searchParams.append("sui_recipient", suiRecipient);

		const res = await fetch(url.toString());
		if (!res.ok) {
			throw new Error(`Failed to get status by Sui address: ${res.statusText}`);
		}
		return res.json();
	}

	async getDepositsBySender(senderAddress: string): Promise<TxStatusResp[]> {
		const url = new URL(this.#url + RestPath.depositsBySender);
		url.searchParams.append("sender", senderAddress);

		const res = await fetch(url.toString());
		if (!res.ok) {
			throw new Error(`Failed to get deposits by sender: ${res.statusText}`);
		}
		return res.json();
	}
}
