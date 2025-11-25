import { IndexerStorage } from "./storage";
import type { MintEventNode, UtxoRecord } from "./models";
import { logger } from "@gonative-cc/lib/logger";
import type { SuiNet } from "@gonative-cc/lib/nsui";

export async function handleMintEvents(
	events: MintEventNode[],
	storage: IndexerStorage,
	nbtcPkg: string,
	suiNetwork: SuiNet,
) {
	const utxosToInsert: UtxoRecord[] = [];

	for (const eventNode of events) {
		const event = eventNode.json;

		const txIdBuffer = Buffer.from(event.btc_tx_id);
		// NOTE: bitcoin library we use in the other worker uses tx.getId() which returns the reversed order, its just for consistency
		// TODO: check if we actually need that
		const txId = txIdBuffer.reverse().toString("hex");

		const scriptPubkey = new Uint8Array(event.bitcoin_spend_key);

		utxosToInsert.push({
			sui_id: event.utxo_idx,
			txid: txId,
			vout: event.btc_vout, // TODO: add vout to event in the smart contract, we support only one VOUT
			amount_sats: Number(event.amount),
			script_pubkey: scriptPubkey,
			nbtc_pkg: nbtcPkg,
			sui_network: suiNetwork,
			status: "available",
			locked_until: null,
		});
	}

	if (utxosToInsert.length > 0) {
		await storage.insertUtxos(utxosToInsert);
		logger.info({
			msg: "Indexed UTXOs from Sui Events",
			count: utxosToInsert.length,
			network: suiNetwork,
		});
	}
}
