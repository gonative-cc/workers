import { SuiClient as Client, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import type { SolveRedeemCall, ProposeRedeemCall } from "./models";
import type { SuiNet } from "@gonative-cc/lib/nsui";
import { type IkaClient, IkaClientImp } from "./ika_client";

export interface SuiClientCfg {
	network: SuiNet;
	signerMnemonic: string;
	ikaClient: IkaClient;
	client: Client;
}

export interface SuiClient {
	proposeRedeemUtxos(args: ProposeRedeemCall): Promise<string>;
	solveRedeemRequest(args: SolveRedeemCall): Promise<string>;
	getSigHash(
		redeemId: number,
		inputIdx: number,
		nbtcPkg: string,
		nbtcContract: string,
	): Promise<Uint8Array>;
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

	constructor(cfg: SuiClientCfg) {
		this.client = cfg.client;
		this.signer = Ed25519Keypair.deriveKeypair(cfg.signerMnemonic);
		this.network = cfg.network;
		this.ikaClient = cfg.ikaClient;
	}

	async getRedeemBtcTx(redeemId: number, nbtcPkg: string, nbtcContract: string): Promise<string> {
		const tx = new Transaction();

		const redeem = tx.moveCall({
			target: `${nbtcPkg}::nbtc::redeem_request`,
			arguments: [tx.object(nbtcContract), tx.pure.u64(redeemId)],
		});

		const storage = tx.moveCall({
			target: `${nbtcPkg}::nbtc::storage`,
			arguments: [tx.object(nbtcContract)],
		});

		tx.moveCall({
			target: `${nbtcPkg}::redeem_request::raw_signed_tx`,
			arguments: [redeem, storage],
		});

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
		const target = `${args.nbtcPkg}::nbtc::propose_utxos`;
		tx.moveCall({
			target: target,
			arguments: [
				tx.object(args.nbtcContract),
				tx.pure.u64(args.redeemId),
				tx.pure.vector("u64", args.utxoIds), // utxo_ids
				tx.pure.vector("address", args.dwalletIds), // dwallet_ids
				tx.object("0x6"), // clock
			],
		});

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
		const target = `${args.nbtcPkg}::nbtc::finalize_redeem_request`; // TODO: for the next deployment change to solve_redeem_request
		tx.moveCall({
			target: target,
			arguments: [
				tx.object(args.nbtcContract),
				tx.pure.u64(args.redeemId),
				tx.object("0x6"), // clock
			],
		});

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

	async getSigHash(
		redeemId: number,
		inputIdx: number,
		nbtcPkg: string,
		nbtcContract: string,
	): Promise<Uint8Array> {
		const tx = new Transaction();

		const redeem = tx.moveCall({
			target: `${nbtcPkg}::nbtc::redeem_request`,
			arguments: [tx.object(nbtcContract), tx.pure.u64(redeemId)],
		});

		const storage = tx.moveCall({
			target: `${nbtcPkg}::nbtc::storage`,
			arguments: [tx.object(nbtcContract)],
		});

		tx.moveCall({
			target: `${nbtcPkg}::redeem_request::sig_hash`,
			arguments: [redeem, tx.pure.u64(inputIdx), storage],
		});

		const result = await this.client.devInspectTransactionBlock({
			transactionBlock: tx,
			sender: this.signer.toSuiAddress(),
		});

		if (result.error) {
			throw new Error(`DevInspect failed: ${result.error}`);
		}

		// The result is in the 3rd return value of the transaction (index 2 in results array)
		// results[0] = redeem_request, results[1] = storage, results[2] = sig_hash
		// TODO: lets compute to sigHash locally rather than querying it from the contract every time
		const sigHashResult = result.results?.[2]?.returnValues?.[0]?.[0];
		if (!sigHashResult) {
			throw new Error("Failed to get sig_hash result");
		}

		return Uint8Array.from(sigHashResult);
	}

	async createGlobalPresign(): Promise<string> {
		const tx = new Transaction();

		const ikaCoin = await this.ikaClient.selectIkaCoin(this.signer.toSuiAddress());

		if (!this.encryptionKeyId) {
			const dWalletEncryptionKey = await this.ikaClient.getLatestNetworkEncryptionKeyId();
			this.encryptionKeyId = dWalletEncryptionKey;
		}

		// TODO: Implement recovery for unused presign objects.
		// If the worker crashes after creating a presign but before using it, the presign object
		// remains in the wallet, to be used. We should scan for it or save it in a db
		const presignCap = this.ikaClient.requestGlobalPresign(
			tx,
			tx.object(ikaCoin),
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

		const ikaCoin = await this.ikaClient.selectIkaCoin(this.signer.toSuiAddress());
		const coordinatorId = this.ikaClient.getCoordinatorId();

		const unverifiedPresignCap = await this.ikaClient.getPresignCapId(presignId);
		const sessionIdentifier = this.ikaClient.createSessionIdentifier(tx);

		tx.moveCall({
			target: `${nbtcPkg}::nbtc::request_signature_for_input`,
			arguments: [
				tx.object(nbtcContract),
				tx.object(coordinatorId),
				tx.pure.u64(redeemId),
				tx.pure.u64(inputIdx),
				tx.pure.vector("u8", nbtcPublicSignature),
				tx.object(unverifiedPresignCap),
				sessionIdentifier,
				tx.object(ikaCoin),
				tx.gas, // paymentSui
			],
		});

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

		tx.moveCall({
			target: `${nbtcPkg}::nbtc::record_signature`,
			arguments: [
				tx.object(nbtcContract),
				tx.object(coordinatorId),
				tx.pure.u64(redeemId),
				tx.pure.u64(inputIdx),
				tx.object(signId),
			],
		});

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
			}),
		);
	}
	return clients;
}
