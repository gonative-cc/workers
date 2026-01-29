import type { Utxo, RedeemRequest } from "./models";
import type {
	RedeemRequestWithInputs,
	RedeemInput,
	RedeemRequestWithNetwork,
	D1Storage,
} from "./storage";
import type { SuiClient } from "./redeem-sui-client";
import { logger, logError } from "@gonative-cc/lib/logger";
import type { SuiNet } from "@gonative-cc/lib/nsui";
import type { BtcIndexerRpc } from "@gonative-cc/btcindexer/rpc-interface";
import { computeBtcSighash, DEFAULT_FEE_SATS, type UtxoInput, type TxOutput } from "./sighash";

const MAXIMUM_NUMBER_UTXO = 100;

export class RedeemService {
	constructor(
		private storage: D1Storage,
		private clients: Map<SuiNet, SuiClient>,
		private btcIndexer: BtcIndexerRpc,
		private utxoLockTimeMs: number,
		private redeemDurationMs: number,
	) {
		if (clients.size === 0) {
			throw new Error("No SuiClients configured");
		}
	}

	// Propose a solution for pending redeems.
	async processPendingRedeems() {
		const pendingRequests = await this.storage.getPendingRedeems();
		if (pendingRequests.length === 0) {
			logger.info({ msg: "No pending redeem requests" });
			return;
		}

		for (const req of pendingRequests) {
			await this.redeemReqProposeSolution(req);
		}
	}

	async solveReadyRedeems() {
		const maxCreatedAt = Date.now() - this.redeemDurationMs;
		const readyRedeemRequests = await this.storage.getRedeemsReadyForSolving(maxCreatedAt);
		if (readyRedeemRequests.length === 0) {
			return;
		}

		for (const req of readyRedeemRequests) {
			await this.solveRequest(req);
		}
	}

	async processSolvedRedeems() {
		// NOTE: here we are processing only 50 redeems every minute (every cron), we are not
		// looping thought all the solved redeems to avoid cloudflare timeout, since we are
		// already waiting for ika to sign, when calling ikaSdk.getPresignInParicularState
		const solved = await this.storage.getSolvedRedeems();
		if (solved.length === 0) return;

		for (const req of solved) {
			await this.processSolvedRedeem(req);
		}
	}

	async broadcastReadyRedeems() {
		const readyRedeems = await this.storage.getSignedRedeems();
		if (readyRedeems.length === 0) return;

		for (const req of readyRedeems) {
			await this.broadcastRedeem(req);
		}
	}

	private async broadcastRedeem(req: RedeemRequestWithNetwork) {
		logger.info({
			msg: "Broadcasting redeem transaction",
			redeemId: req.redeem_id,
		});

		try {
			const client = this.getSuiClient(req.sui_network);
			const rawTxHex = await client.getRedeemBtcTx(
				req.redeem_id,
				req.nbtc_pkg,
				req.nbtc_contract,
			);

			const { tx_id } = await this.btcIndexer.broadcastRedeemTx(
				rawTxHex,
				req.btc_network,
				req.redeem_id,
			);
			await this.storage.markRedeemBroadcasted(req.redeem_id, tx_id);

			logger.info({
				msg: "Successfully broadcasted redeem transaction",
				redeemId: req.redeem_id,
			});
		} catch (e) {
			logError(
				{
					msg: "Failed to broadcast redeem transaction",
					method: "broadcastRedeem",
					redeemId: req.redeem_id,
				},
				e,
			);
		}
	}

	private async processSolvedRedeem(req: RedeemRequestWithInputs) {
		const client = this.getSuiClient(req.sui_network);
		const inputsToVerify: RedeemInput[] = [];

		for (const input of req.inputs) {
			try {
				if (!input.sign_id) {
					await this.requestIkaSig(client, req, input);
				} else if (input.sign_id && !input.verified) {
					inputsToVerify.push(input);
				}
			} catch (e) {
				logError(
					{
						msg: "Failed to process input",
						method: "processSolvedRedeem",
						redeemId: req.redeem_id,
						utxoId: input.utxo_id,
						step: !input.sign_id ? "request_signature" : "verify_signature",
					},
					e,
				);
			}
		}

		if (inputsToVerify.length > 0) {
			try {
				await this.recordIkaSignatures(client, req, inputsToVerify);
			} catch (e) {
				logError(
					{
						msg: "Failed to batch verify signatures",
						method: "processSolvedRedeem",
						redeemId: req.redeem_id,
						count: inputsToVerify.length,
					},
					e,
				);
			}
		}
	}
	// TODO: handle front runs
	private async requestIkaSig(
		client: SuiClient,
		req: RedeemRequestWithInputs,
		input: RedeemInput,
	) {
		logger.info({
			msg: "Requesting signature for input",
			redeemId: req.redeem_id,
			utxoId: input.utxo_id,
			inputIdx: input.input_index,
		});

		const utxos = await this.storage.getRedeemUtxosWithDetails(req.redeem_id);
		const redeemData = await this.storage.getRedeemRequestData(req.redeem_id);

		if (!redeemData) {
			throw new Error(`Redeem request ${req.redeem_id} not found`);
		}

		const inputs: UtxoInput[] = utxos.map((u) => ({
			txid: u.txid,
			vout: u.vout,
			amount: u.amount,
			script_pubkey: u.script_pubkey,
		}));

		const totalInput = inputs.reduce((sum, inp) => sum + inp.amount, 0);

		if (redeemData.amount < DEFAULT_FEE_SATS) {
			throw new Error(
				`Redeem amount ${redeemData.amount} is less than minimum fee ${DEFAULT_FEE_SATS}`,
			);
		}

		const userReceiveAmount = redeemData.amount - DEFAULT_FEE_SATS;
		const remainAmount = totalInput - redeemData.amount;

		const outputs: TxOutput[] = [
			{
				amount: userReceiveAmount,
				script: redeemData.recipient_script,
			},
		];

		if (remainAmount > 0) {
			const firstUtxo = utxos[0];
			if (!firstUtxo) {
				throw new Error("No UTXOs available for change output");
			}
			outputs.push({
				amount: remainAmount,
				script: firstUtxo.script_pubkey,
			});
		}

		const message = computeBtcSighash(inputs, outputs, input.input_index);
		const ika = client.ikaClient();

		// TODO: in DB we should save completed presign objects, not IDs
		let presignId = await this.storage.popPresignObject(req.sui_network);
		if (!presignId) {
			logger.debug({
				msg: "No presign object in pool, creating new one",
				redeemId: req.redeem_id,
			});
			presignId = await client.requestIkaPresign();
		} else {
			logger.debug({
				msg: "Using existing presign object from pool",
				redeemId: req.redeem_id,
				presignId,
			});
		}

		let signId: string;
		try {
			const presign = await ika.getCompletedPresign(presignId);
			const nbtcPublicSignature = await ika.createUserSigMessage(
				input.dwallet_id,
				presign,
				message,
			);

			signId = await client.requestInputSignature(
				req.redeem_id,
				input.input_index,
				nbtcPublicSignature,
				presignId,
				req.nbtc_pkg,
				req.nbtc_contract,
			);
		} catch (e) {
			logger.warn({
				msg: "Failed to request signature, returning presign object to pool",
				redeemId: req.redeem_id,
				presignId,
				error: e,
			});
			await this.storage.insertPresignObject(presignId, req.sui_network);
			throw e;
		}

		try {
			await this.storage.updateRedeemInputSig(req.redeem_id, input.utxo_id, signId);
			logger.debug({
				msg: "Requested signature",
				redeemId: req.redeem_id,
				utxoId: input.utxo_id,
				signId: signId,
			});
		} catch (e) {
			// Here the presign is already consumed so we should not attempt to save it back to the DB.
			logError(
				{
					msg: "Failed to record signature ID in DB",
					method: "requestIkaSig",
					redeemId: req.redeem_id,
					signId,
				},
				e,
			);
			throw e;
		}
	}

	private async recordIkaSignatures(
		client: SuiClient,
		req: RedeemRequestWithInputs,
		inputs: RedeemInput[],
	) {
		const inputsWithSignId = inputs.filter(
			(input): input is RedeemInput & { sign_id: string } => input.sign_id !== null,
		);

		if (inputsWithSignId.length === 0) {
			return;
		}

		logger.info({
			msg: "Batch verifying signatures",
			redeemId: req.redeem_id,
			count: inputsWithSignId.length,
		});

		await client.validateSignatures(
			req.redeem_id,
			inputsWithSignId,
			req.nbtc_pkg,
			req.nbtc_contract,
		);

		for (const input of inputsWithSignId) {
			await this.storage.markRedeemInputVerified(req.redeem_id, input.utxo_id);
		}

		logger.info({
			msg: "Signatures verified",
			redeemId: req.redeem_id,
			count: inputsWithSignId.length,
		});
	}

	private getSuiClient(suiNet: SuiNet): SuiClient {
		const c = this.clients.get(suiNet);
		if (c === undefined) throw new Error("No SuiClient for the sui network = " + suiNet);
		return c;
	}

	private async redeemReqProposeSolution(req: RedeemRequest) {
		logger.info({
			msg: "Processing redeem request",
			redeemId: req.redeem_id,
			amount: req.amount.toString(),
		});
		// TODO: we should only fetch it once for all requests. So we fetch it in processPendingRedeems and the pass it to this method
		const availableUtxos = await this.storage.getAvailableUtxos(req.setup_id);
		const selectedUtxos = selectUtxos(availableUtxos, req.amount);

		if (!selectedUtxos) {
			logger.warn({
				msg: "Insufficient UTXOs for request",
				redeemId: req.redeem_id,
				neededAmount: req.amount.toString(),
			});
			return;
		}

		const client = this.getSuiClient(req.sui_network);

		try {
			const existingUtxoCount = await client.getRedeemUtxoCount(
				req.redeem_id,
				req.nbtc_pkg,
				req.nbtc_contract,
			);

			if (existingUtxoCount > 0 && selectedUtxos.length >= existingUtxoCount) {
				logger.info({
					msg: "Existing solution is equal or better, skipping proposal",
					redeemId: req.redeem_id,
					existingUtxoCount,
					ourUtxoCount: selectedUtxos.length,
				});
				return;
			}
		} catch (e) {
			logger.warn({
				msg: "Failed to fetch existing UTXO count, proceeding with proposal",
				redeemId: req.redeem_id,
				error: e,
			});
		}

		try {
			const txDigest = await client.proposeRedeemUtxos({
				redeemId: req.redeem_id,
				utxoIds: selectedUtxos.map((u) => u.nbtc_utxo_id),
				dwalletIds: selectedUtxos.map((u) => u.dwallet_id),
				nbtcPkg: req.nbtc_pkg,
				nbtcContract: req.nbtc_contract,
			});

			logger.info({
				msg: "Proposed UTXOs for redeem request",
				redeemId: req.redeem_id,
				txDigest: txDigest,
			});
			await this.storage.markRedeemProposed(
				req.redeem_id,
				selectedUtxos.map((u) => u.nbtc_utxo_id),
				this.utxoLockTimeMs,
			);
		} catch (e: unknown) {
			logError(
				{
					msg: "Failed to propose UTXOs for redeem request",
					method: "processRequest",
					redeemId: req.redeem_id,
				},
				e,
			);
		}
	}

	private async solveRequest(req: RedeemRequest) {
		logger.info({
			msg: "Finalizing redeem request",
			redeemId: req.redeem_id,
		});

		try {
			const client = this.getSuiClient(req.sui_network);
			// NOTE: we are not using a PBT here to avoid problems when someone frontruns this call
			const txDigest = await client.solveRedeemRequest({
				redeemId: req.redeem_id,
				nbtcPkg: req.nbtc_pkg,
				nbtcContract: req.nbtc_contract,
			});

			logger.info({
				msg: "Solved redeem request",
				redeemId: req.redeem_id,
				txDigest: txDigest,
			});

			await this.storage.markRedeemSolved(req.redeem_id);
		} catch (e: unknown) {
			logError(
				{
					msg: "Failed to solve redeem request",
					method: "solveRequest",
					redeemId: req.redeem_id,
				},
				e,
			);
		}
	}
}

// V1 version
function selectUtxos(available: Utxo[], targetAmount: number): Utxo[] | null {
	let sum = 0;
	const selected: Utxo[] = [];

	for (const utxo of available) {
		if (selected.length >= MAXIMUM_NUMBER_UTXO) {
			break;
		}
		sum += utxo.amount;
		selected.push(utxo);
		if (sum >= targetAmount) {
			return selected;
		}
	}

	return null;
}
