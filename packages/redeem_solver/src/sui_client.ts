import { SuiClient as Client, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import type { SolveRedeemCall, ProposeRedeemCall } from "./models";
import type { SuiNet } from "@gonative-cc/lib/nsui";
import {
	IkaClient,
	IkaTransaction,
	getNetworkConfig,
	Curve,
	SignatureAlgorithm,
	Hash,
	SessionsManagerModule,
	CoordinatorInnerModule,
	createUserSignMessageWithCentralizedOutput,
	type IkaConfig,
} from "@ika.xyz/sdk";

export interface SuiClientCfg {
	network: SuiNet;
	signerMnemonic: string;
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
}

export class SuiClientImp implements SuiClient {
	private client: Client;
	private signer: Ed25519Keypair;
	private ikaClient: IkaClient;
	private ikaConfig: IkaConfig;
	private network: SuiNet;
	private encryptionKeyId: string | null = null;

	constructor(cfg: SuiClientCfg) {
		const url = getFullnodeUrl(cfg.network);
		this.client = new Client({ url });
		this.signer = Ed25519Keypair.deriveKeypair(cfg.signerMnemonic);
		this.network = cfg.network;

		// this is needed because ika do not support devnet as of now
		const ikaNetwork = this.network === "mainnet" ? "mainnet" : "testnet";
		this.ikaConfig = getNetworkConfig(ikaNetwork);

		this.ikaClient = new IkaClient({
			suiClient: this.client,
			config: this.ikaConfig,
		});
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
		await this.ensureIkaInitialized();
		const tx = new Transaction();
		const ikaTx = new IkaTransaction({
			ikaClient: this.ikaClient,
			transaction: tx,
		});

		const ikaCoin = await this.getIkaCoin(this.signer.toSuiAddress());

		if (!this.encryptionKeyId) {
			const dWalletEncryptionKey = await this.ikaClient.getLatestNetworkEncryptionKey();
			this.encryptionKeyId = dWalletEncryptionKey.id;
		}

		// TODO: Implement recovery for unused presign objects.
		// If the worker crashes after creating a presign but before using it, the presign object
		// remains in the wallet, to be used. We should scan for it or save it in a db
		const presignCap = ikaTx.requestGlobalPresign({
			curve: Curve.SECP256K1,
			signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
			ikaCoin: tx.object(ikaCoin),
			suiCoin: tx.gas,
			dwalletNetworkEncryptionKeyId: this.encryptionKeyId,
		});

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

		const eventDecoded = SessionsManagerModule.DWalletSessionEvent(
			CoordinatorInnerModule.PresignRequestEvent,
		).fromBase64(event.bcs as string);

		return eventDecoded.event_data.presign_id;
	}

	async createUserSigMessage(
		dwalletId: string,
		presignId: string,
		message: Uint8Array,
	): Promise<Uint8Array> {
		await this.ensureIkaInitialized();

		const dWallet = await this.ikaClient.getDWalletInParticularState(dwalletId, "Active");
		// TODO: create presign objects upfront and use them
		const presign = await this.ikaClient.getPresignInParticularState(presignId, "Completed", {
			timeout: 60000,
			interval: 1000,
		});

		const protocolPublicParameters = await this.ikaClient.getProtocolPublicParameters(
			dWallet,
			Curve.SECP256K1, // TODO: change to taproot
		);

		const centralizedDkgOutput = Uint8Array.from(dWallet.state.Active.public_output);
		const userSecretKeyShare = Uint8Array.from(
			dWallet.public_user_secret_key_share as number[],
		);
		const presignState = Uint8Array.from(presign.state.Completed.presign as number[]);

		const nbtcPublicSignature = await createUserSignMessageWithCentralizedOutput(
			protocolPublicParameters,
			centralizedDkgOutput,
			userSecretKeyShare,
			presignState,
			message,
			Hash.SHA256,
			SignatureAlgorithm.ECDSASecp256k1,
			Curve.SECP256K1,
		);

		return nbtcPublicSignature;
	}

	async requestInputSignature(
		redeemId: number,
		inputIdx: number,
		nbtcPublicSignature: Uint8Array,
		presignId: string,
		nbtcPkg: string,
		nbtcContract: string,
	): Promise<string> {
		await this.ensureIkaInitialized();
		const tx = new Transaction();
		const ikaTx = new IkaTransaction({
			ikaClient: this.ikaClient,
			transaction: tx,
		});

		const ikaCoin = await this.getIkaCoin(this.signer.toSuiAddress());
		const coordinatorId = this.ikaConfig.objects.ikaDWalletCoordinator.objectID;

		const unverifiedPresignCap = (
			await this.ikaClient.getPresignInParticularState(presignId, "Completed")
		).cap_id;

		tx.moveCall({
			target: `${nbtcPkg}::nbtc::request_signature_for_input`,
			arguments: [
				tx.object(nbtcContract),
				tx.object(coordinatorId),
				tx.pure.u64(redeemId),
				tx.pure.u64(inputIdx),
				tx.pure.vector("u8", nbtcPublicSignature),
				tx.object(unverifiedPresignCap),
				ikaTx.createSessionIdentifier(),
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

		const eventDecoded = SessionsManagerModule.DWalletSessionEvent(
			CoordinatorInnerModule.SignRequestEvent,
		).fromBase64(event.bcs as string);

		return eventDecoded.event_data.sign_id;
	}

	private async ensureIkaInitialized() {
		if (this.ikaClient.initialize) {
			await this.ikaClient.initialize();
		}
	}

	private async getIkaCoin(addr: string): Promise<string> {
		const coins = await this.client.getCoins({
			owner: addr,
			coinType: `${this.ikaConfig.packages.ikaPackage}::ika::IKA`,
			limit: 5,
		});
		// TODO: for now lets just take the first one
		const firstCoin = coins.data[0];
		if (!firstCoin) {
			throw new Error(`No IKA coins found for address ${addr}`);
		}

		return firstCoin.coinObjectId;
	}
}

export function createSuiClients(
	activeNetworks: SuiNet[],
	mnemonic: string,
): Map<SuiNet, SuiClient> {
	const clients = new Map<SuiNet, SuiClient>();
	for (const net of activeNetworks) {
		clients.set(
			net,
			new SuiClientImp({
				network: net,
				signerMnemonic: mnemonic,
			}),
		);
	}
	return clients;
}
