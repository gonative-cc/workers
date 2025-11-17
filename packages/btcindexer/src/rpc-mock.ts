import { WorkerEntrypoint } from "cloudflare:workers";
import type { TxStatusResp } from "./models";
import { TxStatus } from "./models";
import { Transaction } from "bitcoinjs-lib";
import { OP_RETURN } from "./opcodes";
import type { InterfaceBtcIndexerRpc, PutNbtcTxResponse } from "./rpc-interface";
import { BitcoinNetwork } from "@gonative-cc/lib/bitcoin";

interface MockTxData {
	suiRecipient: string;
	amountSats: number;
	createdAt: number;
}

// in-memory storage: BTC txid  -> tx data
const txData = new Map<string, MockTxData>();
// index: Sui address  -> set of BTC txids
const addressIndex = new Map<string, Set<string>>();

const CONFIRMATION_DEPTH = 4;
const MAX_CONFIRMATIONS = 5;

function parseSuiRecipient(script: Buffer): string | null {
	if (!script.length || script[0] !== OP_RETURN) return null;
	if (script.length < 2) return null;

	const payload = script.subarray(2);
	if (payload[0] === 0x00) {
		return `0x${payload.subarray(1).toString("hex")}`;
	}
	return null;
}

function getStatus(createdAt: number) {
	const elapsed_time = Math.floor((Date.now() - createdAt) / 1000);

	if (elapsed_time < 10) {
		return { status: TxStatus.BROADCASTING, confirmations: 0 };
	}

	const confs = Math.min(Math.floor((elapsed_time - 10) / 120) + 1, MAX_CONFIRMATIONS);

	if (confs < CONFIRMATION_DEPTH) return { status: TxStatus.CONFIRMING, confirmations: confs };
	if (confs === CONFIRMATION_DEPTH) return { status: TxStatus.FINALIZED, confirmations: confs };
	return { status: TxStatus.MINTED, confirmations: confs };
}

function buildTxStatusResp(txid: string, data: MockTxData): TxStatusResp {
	const { status, confirmations } = getStatus(data.createdAt);

	return {
		btc_tx_id: txid,
		status,
		block_height: null,
		confirmations,
		sui_recipient: data.suiRecipient,
		amount_sats: data.amountSats,
		sui_tx_id: null,
	};
}

export class BtcIndexerRpcMock extends WorkerEntrypoint<Env> implements InterfaceBtcIndexerRpc {
	private get txStatuses() {
		return txData;
	}
	private get suiAddressIndex() {
		return addressIndex;
	}

	async latestHeight(): Promise<{ height: number | null }> {
		return { height: 100 };
	}

	async putNbtcTx(txHex: string, _network: BitcoinNetwork): Promise<PutNbtcTxResponse> {
		const tx = Transaction.fromHex(txHex);
		const tx_id = tx.getId();

		let suiRecipient: string | null = null;
		for (const vout of tx.outs) {
			const parsed = parseSuiRecipient(vout.script);
			if (parsed) {
				suiRecipient = parsed;
				break;
			}
		}

		if (!suiRecipient) {
			throw new Error("Transaction does not contain a valid Sui recipient in OP_RETURN");
		}

		let amountSats = 0;
		for (const vout of tx.outs) {
			amountSats += vout.value;
		}

		this.txStatuses.set(tx_id, {
			suiRecipient,
			amountSats,
			createdAt: Date.now(),
		});

		if (!this.suiAddressIndex.has(suiRecipient)) {
			this.suiAddressIndex.set(suiRecipient, new Set());
		}
		this.suiAddressIndex.get(suiRecipient)?.add(tx_id);

		return { tx_id, registered_deposits: 1 };
	}

	async statusByTxid(txid: string): Promise<TxStatusResp | null> {
		const data = this.txStatuses.get(txid);
		if (!data) return null;

		return buildTxStatusResp(txid, data);
	}

	async statusBySuiAddress(suiAddress: string): Promise<TxStatusResp[]> {
		const txIds = this.suiAddressIndex.get(suiAddress);
		if (!txIds || txIds.size === 0) return [];

		const results: TxStatusResp[] = [];
		for (const txId of txIds) {
			const data = this.txStatuses.get(txId);
			if (data) {
				results.push(buildTxStatusResp(txId, data));
			}
		}

		return results;
	}

	async depositsBySender(_address: string): Promise<TxStatusResp[]> {
		// Mock do not track sender addresses, it returns an  empty array
		return [];
	}
}
