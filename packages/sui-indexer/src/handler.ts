import { D1Storage } from "./storage";
import {
	type MintEventRaw,
	type ProposeUtxoEventRaw,
	type SolvedEventRaw,
	type SignatureRecordedEventRaw,
	type CompletedSignEventRaw,
	type RejectedSignEventRaw,
	type SuiEventNode,
	UtxoStatus,
} from "./models";
import { type RedeemRequestEventRaw } from "@gonative-cc/lib/rpc-types";
import { logger } from "@gonative-cc/lib/logger";
import { fromBase64 } from "@mysten/sui/utils";
import type { SuiClient } from "./redeem-sui-client";

export class NbtcEventHandler {
	constructor(
		private storage: D1Storage,
		private setupId: number,
	) {}

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
				await this.handleSolvedRedeem(json as SolvedEventRaw);
			} else if (e.type.includes("::nbtc::redeem_request::SignatureRecordedEvent")) {
				await this.handleIkaSignatureRecorded(json as SignatureRecordedEventRaw);
			}
		}
	}

	private async handleMint(_txDigest: string, e: MintEventRaw) {
		// NOTE: Sui contract gives us the txid in big-endian, but bitcoinjs-lib's tx.getId()
		// returns it in little-endian (see https://github.com/bitcoinjs/bitcoinjs-lib/blob/dc8d9e26f2b9c7380aec7877155bde97594a9ade/ts_src/transaction.ts#L617)
		// so we reverse here to match what the btcindexer uses
		const txId = fromBase64(e.btc_tx_id).reverse().toHex();

		await this.storage.insertUtxo({
			nbtc_utxo_id: Number(e.utxo_id),
			dwallet_id: e.dwallet_id,
			txid: txId,
			vout: e.btc_vout,
			amount: Number(e.btc_amount),
			script_pubkey: fromBase64(e.btc_script_publickey),
			setup_id: this.setupId,
			status: UtxoStatus.Available,
			locked_until: null,
		});
		logger.info({ msg: "Indexed Mint", utxo: e.utxo_id });
	}

	private async handleRedeemRequest(txDigest: string, e: RedeemRequestEventRaw) {
		await this.storage.insertRedeemRequest({
			redeem_id: Number(e.redeem_id),
			redeemer: e.redeemer,
			recipient_script: fromBase64(e.recipient_script),
			amount: Number(e.amount),
			created_at: Number(e.created_at),
			setup_id: this.setupId,
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

	private async handleSolvedRedeem(e: SolvedEventRaw) {
		await this.storage.upsertRedeemInputs(
			Number(e.redeem_id),
			e.utxo_ids.map(Number),
			e.dwallet_ids,
		);
		await this.storage.markRedeemSigning(Number(e.redeem_id));

		logger.info({
			msg: "Marked redeem as singing status and added inputs",
			redeemId: e.redeem_id,
			utxos: e.utxo_ids.length,
		});
	}

	private async handleIkaSignatureRecorded(e: SignatureRecordedEventRaw) {
		await this.storage.markRedeemInputVerified(Number(e.redeem_id), Number(e.utxo_id));
		logger.info({
			msg: "Marked redeem input as verified",
			redeemId: e.redeem_id,
			utxoId: e.utxo_id,
		});
	}
}
export class IkaEventHandler {
	constructor(
		private storage: D1Storage,
		private suiClient: SuiClient,
	) {}

	public async handleEvents(events: SuiEventNode[]) {
		for (const e of events) {
			if (e.type.includes("::coordinator_inner::CompletedSignEvent")) {
				await this.handleCompletedSign(e);
			} else if (e.type.includes("::coordinator_inner::RejectedSignEvent")) {
				await this.handleRejectedSign(e);
			}
		}
	}

	private async handleCompletedSign(e: SuiEventNode) {
		const data = e.json as CompletedSignEventRaw;
		const signId = data.sign_id as string;

		// IKA coordinator is shared across protocols, so we only process sign IDs that match our redeems.
		// The final signature is recorded via SignatureRecordedEvent from nbtc.move (handled above).
		const redeemInfo = await this.storage.getRedeemInfoBySignId(signId);
		if (!redeemInfo) {
			return;
		}

		logger.debug({
			msg: "Ika signature completed",
			sign_id: signId,
			is_future_sign: data.is_future_sign,
			signature_length: data.signature.length,
			txDigest: e.txDigest,
		});

		await this.suiClient.validateSignatures(
			redeemInfo.redeem_id,
			[{ input_index: redeemInfo.input_index, sign_id: signId }],
			redeemInfo.nbtc_pkg,
			redeemInfo.nbtc_contract,
		);
		await this.storage.markRedeemInputVerified(redeemInfo.redeem_id, redeemInfo.utxo_id);

		logger.info({
			msg: "Recorded Ika signature",
			redeem_id: redeemInfo.redeem_id,
			utxo_id: redeemInfo.utxo_id,
			sign_id: signId,
		});
	}

	private async handleRejectedSign(e: SuiEventNode) {
		const data = e.json as RejectedSignEventRaw;
		const signId = data.sign_id as string;
		const redeemInfo = await this.storage.getRedeemInfoBySignId(signId);
		if (!redeemInfo) {
			return;
		}

		logger.warn({
			msg: "Ika signature rejected, clearing sign_id for retry",
			sign_id: signId,
			redeem_id: redeemInfo.redeem_id,
			utxo_id: redeemInfo.utxo_id,
		});
		await this.storage.clearRedeemInputSignId(redeemInfo.redeem_id, redeemInfo.utxo_id);
	}
}
