import { IndexerStorage } from "./storage";
import type {
	MintEventRaw,
	ProposeUtxoEventRaw,
	RedeemRequestEventRaw,
	SuiEventNode,
} from "./models";
import { logger } from "@gonative-cc/lib/logger";
import type { SuiNet } from "@gonative-cc/lib/nsui";

export async function handleEvents(
	events: SuiEventNode[],
	storage: IndexerStorage,
	nbtcPkg: string,
	suiNetwork: SuiNet,
) {
	for (const event of events) {
		const json = event.json;

		if (event.type.includes("::MintEvent")) {
			await handleMint(json as MintEventRaw, storage, nbtcPkg, suiNetwork);
		} else if (event.type.includes("::RedeemRequestEvent")) {
			await handleRedeemRequest(json as RedeemRequestEventRaw, storage, nbtcPkg, suiNetwork);
		} else if (event.type.includes("::ProposeUtxoEvent")) {
			await handleProposeUtxo(json as ProposeUtxoEventRaw, storage);
		}
	}
}

async function handleMint(e: MintEventRaw, storage: IndexerStorage, pkg: string, net: SuiNet) {
	// NOTE: bitcoin library we use in the other worker uses tx.getId() which returns the reversed order, its just for consistency
	// TODO: check if we actually need that
	const txId = Buffer.from(e.btc_tx_id).reverse().toString("hex");

	await storage.insertUtxo({
		sui_id: e.utxo_id,
		dwallet_id: e.dwallet_id,
		txid: txId,
		vout: e.btc_vout,
		amount_sats: Number(e.btc_amount),
		script_pubkey: new Uint8Array(e.btc_script_publickey),
		nbtc_pkg: pkg,
		sui_network: net,
		status: "available",
		locked_until: null,
	});
	logger.info({ msg: "Indexed Mint", utxo: e.utxo_id });
}

async function handleRedeemRequest(
	e: RedeemRequestEventRaw,
	storage: IndexerStorage,
	pkg: string,
	net: string,
) {
	await storage.insertRedeemRequest({
		redeem_id: e.redeem_id,
		redeemer: e.redeemer,
		recipient_script: new Uint8Array(e.recipient_script),
		amount_sats: Number(e.amount),
		created_at: Number(e.created_at),
		nbtc_pkg: pkg,
		sui_network: net,
	});
	logger.info({ msg: "Indexed Redeem Request", id: e.redeem_id });
}

async function handleProposeUtxo(e: ProposeUtxoEventRaw, storage: IndexerStorage) {
	// NOTE: the event is only emmited if the proposal is the best, thats why we are locking them here,
	// we should lock them when we are proposing already, and here we should just attempt to lock else ignore
	await storage.lockUtxos(e.utxo_ids);
	logger.info({
		msg: "Locked UTXOs for Proposal",
		redeemId: e.redeem_id,
		count: e.utxo_ids.length,
	});
}
