import { SuiClient as Client, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import type { SolveRedeemCall, ProposeRedeemCall } from "./models";
import type { SuiNet } from "@gonative-cc/lib/nsui";
import { type IkaClient, IkaClientImp } from "./ika_client";
import { nBTCContractModule, RedeemRequestModule } from "@vuvoth/nbtc";

export interface SuiClientCfg {
	network: SuiNet;
	signerMnemonic: string;
	ikaClient: IkaClient;
	client: Client;
	ikaUpperLimit: number;
}

export interface SuiClient {
	proposeRedeemUtxos(args: ProposeRedeemCall): Promise<string>;
	solveRedeemRequest(args: SolveRedeemCall): Promise<string>;
	createGlobalPresign(): Promise<string>;
	createUserSigMessage(
		dwalletId: string,
		presignId: string,
		message: Uint8Array,
	): Promise<Uint8Array>;
	requestInputSignature(
		redeemId: number,
		inputIdx: number,
		nbtcPublicSignature: Uint8Array,
		presignId: string,
		nbtcPkg: string,
		nbtcContract: string,
	): Promise<string>;
	validateSignature(
		redeemId: number,
		inputIdx: number,
		signId: string,
		nbtcPkg: string,
		nbtcContract: string,
	): Promise<void>;
	getRedeemBtcTx(redeemId: number, nbtcPkg: string, nbtcContract: string): Promise<string>;
}

export class SuiClientImp implements SuiClient {
	private client: Client;
	private signer: Ed25519Keypair;
	private ikaClient: IkaClient;
	private network: SuiNet;
	private encryptionKeyId: string | null = null;
	private ikaUpperLimit: number;

	constructor(cfg: SuiClientCfg) {
		this.client = cfg.client;
		this.signer = Ed25519Keypair.deriveKeypair(cfg.signerMnemonic);
		this.network = cfg.network;
		this.ikaClient = cfg.ikaClient;
		this.ikaUpperLimit = cfg.ikaUpperLimit;
	}

	async getRedeemBtcTx(redeemId: number, nbtcPkg: string, nbtcContract: string): Promise<string> {
		const tx = new Transaction();

		const redeem = tx.add(
			nBTCContractModule.redeemRequest({
				package: nbtcPkg,
				arguments: {
					contract: nbtcContract,
					redeemId: redeemId,
				},
			}),
		);

		const storage = tx.add(
			nBTCContractModule.storage({
				package: nbtcPkg,
				arguments: {
					contract: nbtcContract,
				},
			}),
		);

		tx.add(
			RedeemRequestModule.composeTx({
				package: nbtcPkg,
				arguments: {
					r: redeem,
					storage: storage,
				},
			}),
		);

		const result = await this.client.devInspectTransactionBlock({
			transactionBlock: tx,
			sender: this.signer.toSuiAddress(),
		});

		if (result.error) {
			throw new Error(`DevInspect failed: ${result.error}`);
		}

		// results[0] = redeem_request, results[1] = storage, results[2] = raw_signed_tx
		const rawTxResult = result.results?.[2]?.returnValues?.[0]?.[0];
		if (!rawTxResult) {
			throw new Error("Failed to get raw_signed_tx result");
		}
		const decoded = Uint8Array.from(rawTxResult);
		return Buffer.from(decoded).toString("hex");
	}

	async proposeRedeemUtxos(args: ProposeRedeemCall): Promise<string> {
		const tx = new Transaction();

		tx.add(
			nBTCContractModule.proposeUtxos({
				package: args.nbtcPkg,
				arguments: {
					contract: args.nbtcContract,
					redeemId: args.redeemId,
					utxoIds: args.utxoIds.map((u) => BigInt(u)),
				},
			}),
		);

		tx.setGasBudget(100000000); // TODO: Move to config

		const result = await this.client.signAndExecuteTransaction({
			signer: this.signer,
			transaction: tx,
			options: {
				showEffects: true,
			},
		});

		if (result.effects?.status.status !== "success") {
			throw new Error(`Transaction failed: ${result.effects?.status.error}`);
		}

		return result.digest;
	}

	async solveRedeemRequest(args: SolveRedeemCall): Promise<string> {
		const tx = new Transaction();

		tx.add(
			nBTCContractModule.solveRedeemRequest({
				package: args.nbtcPkg,
				arguments: {
					contract: args.nbtcContract,
					redeemId: args.redeemId,
				},
			}),
		);

		tx.setGasBudget(100000000); // TODO: Move to config

		const result = await this.client.signAndExecuteTransaction({
			signer: this.signer,
			transaction: tx,
			options: {
				showEffects: true,
			},
		});

		if (result.effects?.status.status !== "success") {
			throw new Error(`Transaction failed: ${result.effects?.status.error}`);
		}

		return result.digest;
	}

	async createGlobalPresign(): Promise<string> {
		const tx = new Transaction();

		const ikaCoin = await this.ikaClient.prepareIkaCoin(
			tx,
			this.signer.toSuiAddress(),
			this.ikaUpperLimit,
		);

		if (!this.encryptionKeyId) {
			const dWalletEncryptionKey = await this.ikaClient.getLatestNetworkEncryptionKeyId();
			this.encryptionKeyId = dWalletEncryptionKey;
		}

		// TODO: Implement recovery for unused presign objects.
		// If the worker crashes after creating a presign but before using it, the presign object
		// remains in the wallet, to be used. We should scan for it or save it in a db
		const presignCap = this.ikaClient.requestGlobalPresign(
			tx,
			ikaCoin,
			tx.gas,
			this.encryptionKeyId,
		);

		tx.transferObjects([presignCap], this.signer.toSuiAddress());

		const result = await this.client.signAndExecuteTransaction({
			signer: this.signer,
			transaction: tx,
			options: { showEvents: true },
		});

		if (result.effects?.status.status !== "success") {
			throw new Error(`Presign request failed: ${result.effects?.status.error}`);
		}

		const event = result.events?.find((e) => e.type.includes("PresignRequestEvent"));
		if (!event) {
			throw new Error("PresignRequestEvent not found");
		}

		const decoded = this.ikaClient.decodePresignRequestEvent(event.bcs as string);
		return decoded.presign_id;
	}

	async createUserSigMessage(
		dwalletId: string,
		presignId: string,
		message: Uint8Array,
	): Promise<Uint8Array> {
		return await this.ikaClient.createUserSigMessage(dwalletId, presignId, message);
	}

	async requestInputSignature(
		redeemId: number,
		inputIdx: number,
		nbtcPublicSignature: Uint8Array,
		presignId: string,
		nbtcPkg: string,
		nbtcContract: string,
	): Promise<string> {
		const tx = new Transaction();

		const ikaCoin = await this.ikaClient.prepareIkaCoin(
			tx,
			this.signer.toSuiAddress(),
			this.ikaUpperLimit,
		);
		const coordinatorId = this.ikaClient.getCoordinatorId();

		const unverifiedPresignCap = await this.ikaClient.getPresignCapId(presignId);

		tx.add(
			nBTCContractModule.requestUtxoSig({
				package: nbtcPkg,
				arguments: {
					contract: nbtcContract,
					dwalletCoordinator: coordinatorId,
					redeemId: redeemId,
					inputId: inputIdx,
					presign: unverifiedPresignCap,
					paymentIka: ikaCoin,
					msgCentralSig: Array.from(nbtcPublicSignature),
					paymentSui: tx.gas,
				},
			}),
		);

		const result = await this.client.signAndExecuteTransaction({
			signer: this.signer,
			transaction: tx,
			options: { showEvents: true },
		});

		if (result.effects?.status.status !== "success") {
			throw new Error(`Signature request failed: ${result.effects?.status.error}`);
		}

		const event = result.events?.find((e) => e.type.includes("SignRequestEvent"));
		if (!event) {
			throw new Error("SignRequestEvent not found");
		}

		const decoded = this.ikaClient.decodeSignRequestEvent(event.bcs as string);
		return decoded.sign_id;
	}

	async validateSignature(
		redeemId: number,
		inputIdx: number,
		signId: string,
		nbtcPkg: string,
		nbtcContract: string,
	): Promise<void> {
		const tx = new Transaction();
		const coordinatorId = this.ikaClient.getCoordinatorId();

		tx.add(
			nBTCContractModule.recordSignature({
				package: nbtcPkg,
				arguments: {
					contract: nbtcContract,
					dwalletCoordinator: coordinatorId,
					redeemId: redeemId,
					inputIds: inputIdx,
					signIds: [signId],
				},
			}),
		);

		const result = await this.client.signAndExecuteTransaction({
			signer: this.signer,
			transaction: tx,
			options: {
				showEffects: true,
			},
		});

		if (result.effects?.status.status !== "success") {
			throw new Error(`Signature validation failed: ${result.effects?.status.error}`);
		}
	}
}

export async function createSuiClients(
	activeNetworks: SuiNet[],
	mnemonic: string,
	ikaUpperLimit: number,
): Promise<Map<SuiNet, SuiClient>> {
	const clients = new Map<SuiNet, SuiClient>();
	for (const net of activeNetworks) {
		const url = getFullnodeUrl(net);
		const mystenClient = new Client({ url });
		const ikaClient = await IkaClientImp.create(net, mystenClient);
		clients.set(
			net,
			new SuiClientImp({
				network: net,
				signerMnemonic: mnemonic,
				ikaClient: ikaClient,
				client: mystenClient,
				ikaUpperLimit: ikaUpperLimit,
			}),
		);
	}
	return clients;
}
