import { IndexerStorage } from "./storage";
import type {
	MintEventRaw,
	ProposeUtxoEventRaw,
	RedeemRequestEventRaw,
	SuiEventNode,
} from "./models";
import { logger } from "@gonative-cc/lib/logger";
import type { SuiNet } from "@gonative-cc/lib/nsui";
import { fromBase64 } from "@mysten/sui/utils";

export class SuiEventHandler {
	private storage: IndexerStorage;
	private nbtcPkg: string;
	private suiNetwork: SuiNet;

	constructor(storage: IndexerStorage, nbtcPkg: string, suiNetwork: SuiNet) {
		this.storage = storage;
		this.nbtcPkg = nbtcPkg;
		this.suiNetwork = suiNetwork;
	}

	public async handleEvents(events: SuiEventNode[]) {
		for (const event of events) {
			const json = event.json;

			if (event.type.includes("::nbtc::MintEvent")) {
				await this.handleMint(json as MintEventRaw);
			} else if (event.type.includes("::nbtc::RedeemRequestEvent")) {
				await this.handleRedeemRequest(json as RedeemRequestEventRaw);
			} else if (event.type.includes("::nbtc::ProposeUtxoEvent")) {
				await this.handleProposeUtxo(json as ProposeUtxoEventRaw);
			}
		}
	}

	private async handleMint(e: MintEventRaw) {
		// NOTE: bitcoin library we use in the other worker uses tx.getId() which returns the reversed order, its just for consistency
		// TODO: check if we actually need that
		const txId = fromBase64(e.btc_tx_id).reverse().toHex();

		await this.storage.insertUtxo({
			sui_id: e.utxo_id,
			dwallet_id: e.dwallet_id,
			txid: txId,
			vout: e.btc_vout,
			amount_sats: BigInt(e.btc_amount),
			script_pubkey: fromBase64(e.btc_script_publickey),
			nbtc_pkg: this.nbtcPkg,
			sui_network: this.suiNetwork,
			status: "available",
			locked_until: null,
		});
		logger.info({ msg: "Indexed Mint", utxo: e.utxo_id });
	}

	private async handleRedeemRequest(e: RedeemRequestEventRaw) {
		await this.storage.insertRedeemRequest({
			redeem_id: e.redeem_id,
			redeemer: e.redeemer,
			recipient_script: fromBase64(e.recipient_script),
			amount_sats: BigInt(e.amount),
			created_at: Number(e.created_at),
			nbtc_pkg: this.nbtcPkg,
			sui_network: this.suiNetwork,
		});
		logger.info({ msg: "Indexed Redeem Request", id: e.redeem_id });
	}

	private async handleProposeUtxo(e: ProposeUtxoEventRaw) {
		// NOTE: the event is only emmited if the proposal is the best, thats why we are locking them here,
		// we should lock them when we are proposing already, and here we should just attempt to lock else ignore
		await this.storage.lockUtxos(e.utxo_ids);
		logger.info({
			msg: "Locked UTXOs for Proposal",
			redeemId: e.redeem_id,
			count: e.utxo_ids.length,
		});
	}
}
