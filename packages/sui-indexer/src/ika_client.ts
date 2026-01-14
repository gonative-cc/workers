import {
	IkaClient as SdkIkaClient,
	IkaTransaction,
	getNetworkConfig,
	Curve,
	SignatureAlgorithm,
	Hash,
	SessionsManagerModule,
	CoordinatorInnerModule,
	type IkaConfig,
	createUserSignMessageWithPublicOutput,
} from "@ika.xyz/sdk";
import type { SuiNet } from "@gonative-cc/lib/nsui";
import type { SuiClient as MystenClient } from "@mysten/sui/client";
import {
	Transaction,
	type TransactionArgument,
	type TransactionObjectArgument,
} from "@mysten/sui/transactions";

export interface IkaClient {
	/** Returns the coin object ID for an IKA coin owned by the address */
	selectIkaCoin(owner: string): Promise<string>;
	getLatestNetworkEncryptionKeyId(): Promise<string>;
	getCoordinatorId(): string;
	getPresignCapId(presignId: string): Promise<string>;

	createUserSigMessage(
		dwalletId: string,
		presignId: string,
		message: Uint8Array,
	): Promise<Uint8Array>;

	requestGlobalPresign(
		tx: Transaction,
		ikaCoin: TransactionObjectArgument,
		suiCoin: TransactionObjectArgument,
		dwalletNetworkEncryptionKeyId: string,
	): TransactionObjectArgument;

	createSessionIdentifier(tx: Transaction): TransactionArgument;

	decodePresignRequestEvent(bcs: string): { presign_id: string };
	decodeSignRequestEvent(bcs: string): { sign_id: string };
}

export class IkaClientImp implements IkaClient {
	private ikaClient: SdkIkaClient;
	private ikaConfig: IkaConfig;

	constructor(
		network: SuiNet,
		private mystenClient: MystenClient,
	) {
		if (network !== "mainnet" && network !== "testnet") {
			throw new Error(`Ika SDK does not support network: ${network}`);
		}
		this.ikaConfig = getNetworkConfig(network);

		this.ikaClient = new SdkIkaClient({
			suiClient: this.mystenClient,
			config: this.ikaConfig,
		});
	}

	static async create(network: SuiNet, mystenClient: MystenClient): Promise<IkaClient> {
		const client = new IkaClientImp(network, mystenClient);
		await client.initialize();
		return client;
	}

	private async initialize(): Promise<void> {
		if (this.ikaClient.initialize) {
			await this.ikaClient.initialize();
		}
	}

	getCoordinatorId(): string {
		return this.ikaConfig.objects.ikaDWalletCoordinator.objectID;
	}

	async selectIkaCoin(owner: string): Promise<string> {
		const coins = await this.mystenClient.getCoins({
			owner: owner,
			coinType: `${this.ikaConfig.packages.ikaPackage}::ika::IKA`,
			limit: 5,
		});
		// TODO: for now lets just take the first one
		const firstCoin = coins.data[0];
		if (!firstCoin) {
			throw new Error(`No IKA coins found for address ${owner}`);
		}

		return firstCoin.coinObjectId;
	}

	async getLatestNetworkEncryptionKeyId(): Promise<string> {
		const dWalletEncryptionKey = await this.ikaClient.getLatestNetworkEncryptionKey();
		return dWalletEncryptionKey.id;
	}

	async getPresignCapId(presignId: string): Promise<string> {
		const presign = await this.ikaClient.getPresignInParticularState(presignId, "Completed");
		return presign.cap_id;
	}

	async createUserSigMessage(
		dwalletId: string,
		presignId: string,
		message: Uint8Array,
	): Promise<Uint8Array> {
		const dWallet = await this.ikaClient.getDWalletInParticularState(dwalletId, "Active");
		// TODO: create presign objects upfront and use them
		const presign = await this.ikaClient.getPresignInParticularState(presignId, "Completed", {
			timeout: 60000,
			interval: 1000,
		});

		const protocolPublicParameters = await this.ikaClient.getProtocolPublicParameters(
			dWallet,
			Curve.SECP256K1,
		);

		const dWalletPublicOutput = Uint8Array.from(dWallet.state.Active.public_output);
		const userSecretKeyShare = Uint8Array.from(
			dWallet.public_user_secret_key_share as number[],
		);
		const presignState = Uint8Array.from(presign.state.Completed.presign as number[]);

		return await createUserSignMessageWithPublicOutput(
			protocolPublicParameters,
			dWalletPublicOutput,
			userSecretKeyShare,
			presignState,
			message,
			Hash.SHA256,
			SignatureAlgorithm.Taproot,
			Curve.SECP256K1,
		);
	}

	requestGlobalPresign(
		tx: Transaction,
		ikaCoin: TransactionObjectArgument,
		suiCoin: TransactionObjectArgument,
		dwalletNetworkEncryptionKeyId: string,
	): TransactionObjectArgument {
		const ikaTx = new IkaTransaction({
			ikaClient: this.ikaClient,
			transaction: tx,
		});

		return ikaTx.requestGlobalPresign({
			curve: Curve.SECP256K1,
			signatureAlgorithm: SignatureAlgorithm.Taproot,
			ikaCoin: ikaCoin,
			suiCoin: suiCoin,
			dwalletNetworkEncryptionKeyId: dwalletNetworkEncryptionKeyId,
		});
	}

	createSessionIdentifier(tx: Transaction): TransactionArgument {
		const ikaTx = new IkaTransaction({
			ikaClient: this.ikaClient,
			transaction: tx,
		});
		return ikaTx.createSessionIdentifier();
	}

	decodePresignRequestEvent(bcs: string): { presign_id: string } {
		const eventDecoded = SessionsManagerModule.DWalletSessionEvent(
			CoordinatorInnerModule.PresignRequestEvent,
		).fromBase64(bcs);
		return { presign_id: eventDecoded.event_data.presign_id };
	}

	decodeSignRequestEvent(bcs: string): { sign_id: string } {
		const eventDecoded = SessionsManagerModule.DWalletSessionEvent(
			CoordinatorInnerModule.SignRequestEvent,
		).fromBase64(bcs);
		return { sign_id: eventDecoded.event_data.sign_id };
	}
}
