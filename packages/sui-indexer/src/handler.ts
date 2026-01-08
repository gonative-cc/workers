import { IndexerStorage } from "./storage";
import {
	type MintEventRaw,
	type ProposeUtxoEventRaw,
	type RedeemRequestEventRaw,
	type SolvedEventRaw,
	type SignatureRecordedEventRaw,
	type SuiEventNode,
	UtxoStatus,
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
		for (const e of events) {
			const json = e.json;

			if (e.type.includes("::nbtc::MintEvent")) {
				await this.handleMint(e.txDigest, json as MintEventRaw);
			} else if (e.type.includes("::nbtc::RedeemRequestEvent")) {
				await this.handleRedeemRequest(e.txDigest, json as RedeemRequestEventRaw);
			} else if (e.type.includes("::nbtc::ProposeUtxoEvent")) {
				await this.handleProposeUtxo(json as ProposeUtxoEventRaw);
			} else if (e.type.includes("::nbtc::redeem_request::SolvedEvent")) {
				await this.handleSolved(json as SolvedEventRaw);
			} else if (e.type.includes("::nbtc::redeem_request::SignatureRecordedEvent")) {
				await this.handleSignatureRecorded(json as SignatureRecordedEventRaw);
			}
		}
	}

	private async handleMint(txDigest: string, e: MintEventRaw) {
		// NOTE: bitcoin library we use in the other worker uses tx.getId() which returns the
		// reversed order, its just for consistency
		// TODO: check if we actually need that
		const txId = fromBase64(e.btc_tx_id).reverse().toHex();

		await this.storage.insertUtxo({
			nbtc_utxo_id: Number(e.utxo_id),
			dwallet_id: e.dwallet_id,
			txid: txId,
			vout: e.btc_vout,
			amount_sats: Number(e.btc_amount),
			script_pubkey: fromBase64(e.btc_script_publickey),
			nbtc_pkg: this.nbtcPkg,
			sui_network: this.suiNetwork,
			status: UtxoStatus.Available,
			locked_until: null,
		});
		logger.info({ msg: "Indexed Mint", utxo: e.utxo_id });
	}

	private async handleRedeemRequest(txDigest: string, e: RedeemRequestEventRaw) {
		// TODO: we should use setup_id here rather sui_network + nbtc_pkg
		await this.storage.insertRedeemRequest({
			redeem_id: Number(e.redeem_id),
			redeemer: e.redeemer,
			recipient_script: fromBase64(e.recipient_script),
			amount_sats: Number(e.amount),
			created_at: Number(e.created_at),
			nbtc_pkg: this.nbtcPkg,
			sui_network: this.suiNetwork,
			sui_tx: txDigest,
		});
		logger.info({ msg: "Indexed Redeem Request", id: e.redeem_id });
	}

	private async handleProposeUtxo(e: ProposeUtxoEventRaw) {
		// NOTE: the event is only emmited if the proposal is the best, thats why we are locking them here,
		// we should lock them when we are proposing already, and here we should just attempt to lock else ignore
		await this.storage.lockUtxos(e.utxo_ids.map(Number));
		logger.info({
			msg: "Locked UTXOs for Proposal",
			redeemId: e.redeem_id,
			count: e.utxo_ids.length,
		});
	}

	private async handleSolved(e: SolvedEventRaw) {
		await this.storage.upsertRedeemInputs(
			Number(e.redeem_id),
			e.utxo_ids.map(Number),
			e.dwallet_ids,
		);
		await this.storage.markRedeemSolved(Number(e.redeem_id));

		logger.info({
			msg: "Marked redeem as solved and added inputs",
			redeemId: e.redeem_id,
			utxos: e.utxo_ids.length,
		});
	}

	private async handleSignatureRecorded(e: SignatureRecordedEventRaw) {
		await this.storage.markRedeemInputVerified(Number(e.redeem_id), Number(e.utxo_id));
		logger.info({
			msg: "Marked redeem input as verified",
			redeemId: e.redeem_id,
			utxoId: e.utxo_id,
		});
	}
}
