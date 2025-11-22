import { IndexerStorage } from "./storage";
import type { MintEventRaw, UtxoRecord } from "./models";
import { logger } from "@gonative-cc/lib/logger";

export async function handleMintEvents(
	events: { json: unknown }[],
	storage: IndexerStorage,
	nbtcPkg: string,
	suiNetwork: string,
) {
	const utxosToInsert: UtxoRecord[] = [];

	for (const eventNode of events) {
		const event = eventNode.json as MintEventRaw;

		const txIdBuffer = Buffer.from(event.btc_tx_id);
		const txId = txIdBuffer.reverse().toString("hex"); // TODO: check if we need to reverse
		const scriptPubkey = new Uint8Array(event.bitcoin_spend_key);

		utxosToInsert.push({
			sui_id: event.utxo_idx,
			txid: txId,
			vout: event.btc_vout, //TODO: add vout to event, we need to decide if we support multiple or just one
			address: "", //TODO: prolly we dont need it
			amount_sats: Number(event.amount),
			script_pubkey: scriptPubkey,
			nbtc_pkg: nbtcPkg,
			sui_network: suiNetwork,
			status: "available",
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
