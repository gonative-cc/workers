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
const PRESIGN_POOL_TARGET = 100;
const PRESIGN_POOL_MIN_TARGET = 40;
const MAX_CREATE_PER_PTB = 40;

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
	// Makes sure we have enough presigns in the queue
	async refillPresignPool(nets: SuiNet[]) {
		await Promise.allSettled(nets.map((net) => this.refillNetworkPool(net)));
	}

	private async refillNetworkPool(network: SuiNet) {
		let currentCount = await this.storage.getPresignCount(network);
		if (currentCount >= PRESIGN_POOL_MIN_TARGET) return;
		let needed = PRESIGN_POOL_TARGET - currentCount;

		while (needed > 0) {
			const toCreate = Math.min(needed, MAX_CREATE_PER_PTB);
			logger.debug({
				msg: "Filling presign pool",
				network,
				currentCount,
				creating: toCreate,
			});

			const client = this.getSuiClient(network);
			try {
				const presignIds = await client.requestIkaPresigns(toCreate);
				for (const presignId of presignIds) {
					await this.storage.insertPresignObject(presignId, network);
				}
				logger.debug({
					msg: "Created presign objects",
					network,
					count: presignIds.length,
				});
				currentCount += presignIds.length;
				needed -= presignIds.length;
			} catch (e) {
				logError(
					{
						msg: "Failed to create presign objects",
						method: "refillNetworkPool",
						network,
						count: toCreate,
					},
					e,
				);
				break;
			}
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

	async processSigningRedeems() {
		// NOTE: here we are processing only 50 redeems every minute (every cron), we are not
		// looping through all the signing status redeems to avoid cloudflare timeout, since we are
		// already waiting for ika to sign, when calling ikaSdk.getPresignInParticularState
		// Signature verification is handled by the event indexer
		const signings = await this.storage.getSigningRedeems();
		if (signings.length === 0) return;

		for (const req of signings) {
			await this.processSigningRedeem(req);
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

	private async processSigningRedeem(req: RedeemRequestWithInputs) {
		const client = this.getSuiClient(req.sui_network);

		for (const input of req.inputs) {
			try {
				if (!input.sign_id) {
					await this.requestIkaSig(client, req, input);
				}
			} catch (e) {
				logError(
					{
						msg: "Failed to request signature for input",
						method: "processSolvedRedeem",
						redeemId: req.redeem_id,
						utxoId: input.utxo_id,
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
			const presigns = await client.requestIkaPresigns(1);
			if (presigns.length === 0 || !presigns[0]) {
				throw new Error("Failed to create presign object");
			}
			presignId = presigns[0];
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

		try {
			const client = this.getSuiClient(req.sui_network);
			const result = await client.proposeRedeemUtxos({
				redeemId: req.redeem_id,
				utxoIds: selectedUtxos.map((u) => u.nbtc_utxo_id),
				nbtcPkg: req.nbtc_pkg,
				nbtcContract: req.nbtc_contract,
			});

			if (result.effects?.status.status === "success") {
				logger.info({
					msg: "Proposed UTXOs for redeem request",
					redeemId: req.redeem_id,
					txDigest: result.digest,
				});
				await this.storage.markRedeemProposed(
					req.redeem_id,
					selectedUtxos.map((u) => u.nbtc_utxo_id),
					this.utxoLockTimeMs,
				);
			} else {
				const error = result.effects?.status.error ?? "";
				if (isRedeemProgressed(error)) {
					logger.info({
						msg: "Redeem already progressed past proposal phase",
						redeemId: req.redeem_id,
						txDigest: result.digest,
						error,
					});
					let onChainUtxoIds: number[] = [];
					try {
						onChainUtxoIds = await client.getRedeemUtxoIds(
							req.redeem_id,
							req.nbtc_pkg,
							req.nbtc_contract,
						);
					} catch (e) {
						logError(
							{
								msg: "Failed to fetch on-chain UTXO IDs",
								method: "redeemReqProposeSolution",
								redeemId: req.redeem_id,
							},
							e,
						);
					}
					await this.storage.markRedeemProposed(
						req.redeem_id,
						onChainUtxoIds,
						this.utxoLockTimeMs,
					);
				} else {
					// TODO: Add specific error codes in the smart contract for
					// better classification of contract aborts.
					// For now, leave as pending to retry on next cron tick.
					logger.warn({
						msg: "Proposal failed on-chain, will retry",
						redeemId: req.redeem_id,
						txDigest: result.digest,
						error,
					});
				}
			}
		} catch (e: unknown) {
			// Network error: leave as pending so next cron retry.
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
			// update status to signing
			await this.storage.markRedeemSigning(req.redeem_id);
		} catch (e: unknown) {
			logError(
				{
					msg: "Failed to update to signing",
					method: "makeSigning",
					redeemId: req.redeem_id,
				},
				e,
			);
		}
	}
}

// Contract error messages indicating the redeem has progressed past the proposal phase.
function isRedeemProgressed(error: string): boolean {
	return (
		error.includes("not in resolving status") || error.includes("resolving window has expired")
	);
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
