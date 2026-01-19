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
import type { CoinStruct, SuiClient as MystenClient } from "@mysten/sui/client";
import {
	Transaction,
	type TransactionArgument,
	type TransactionObjectArgument,
} from "@mysten/sui/transactions";

export interface IkaClient {
	getLatestNetworkEncryptionKeyId(): Promise<string>;
	getCoordinatorId(): string;
	getPresignCapId(presignId: string): Promise<string>;
	prepareIkaCoin(
		tx: Transaction,
		owner: string,
		maxCoins?: number,
	): Promise<TransactionObjectArgument>;

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

	private async fetchAllIkaCoins(owner: string): Promise<CoinStruct[]> {
		const allCoins: CoinStruct[] = [];
		let cursor: string | null | undefined = null;

		do {
			const result = await this.mystenClient.getCoins({
				owner: owner,
				coinType: `${this.ikaConfig.packages.ikaPackage}::ika::IKA`,
				cursor: cursor,
			});
			allCoins.push(...result.data);
			cursor = result.hasNextPage ? result.nextCursor : null;
		} while (cursor);

		if (allCoins.length === 0) {
			throw new Error(`No IKA coins found for address ${owner}`);
		}

		return allCoins;
	}

	private sortCoinsByBalance(coins: CoinStruct[]): CoinStruct[] {
		return [...coins].sort((a, b) => {
			const aBalance = BigInt(a.balance);
			const bBalance = BigInt(b.balance);
			return Number(bBalance - aBalance);
		});
	}

	private selectBiggestCoins(
		targetBalance: bigint,
		coins: CoinStruct[],
	): { selected: CoinStruct[]; ok: boolean } {
		const sortedCoins = this.sortCoinsByBalance(coins);
		const selected: CoinStruct[] = [];
		let total = BigInt(0);

		for (const coin of sortedCoins) {
			selected.push(coin);
			total += BigInt(coin.balance);
			if (total >= targetBalance) {
				return { selected, ok: true };
			}
		}

		return { selected, ok: total >= targetBalance };
	}
	async prepareIkaCoin(
		tx: Transaction,
		owner: string,
		upperLimit = 100,
	): Promise<TransactionObjectArgument> {
		const allCoins = await this.fetchAllIkaCoins(owner);
		const targetBalance = BigInt(upperLimit);

		const selectedCoins: CoinStruct[] = [];
		let totalBalance = BigInt(0);

		for (const coin of allCoins) {
			if (selectedCoins.length >= upperLimit) {
				break;
			}
			selectedCoins.push(coin);
			totalBalance += BigInt(coin.balance);
			if (totalBalance >= targetBalance) {
				break;
			}
		}

		if (totalBalance < targetBalance && allCoins.length > selectedCoins.length) {
			const { selected, ok } = this.selectBiggestCoins(
				targetBalance - totalBalance,
				allCoins.slice(selectedCoins.length),
			);
			if (!ok) {
				throw new Error(
					`Insufficient IKA balance. Required: ${targetBalance}, available: ${totalBalance}`,
				);
			}
			selectedCoins.push(...selected);
		} else if (totalBalance < targetBalance) {
			throw new Error(
				`Insufficient IKA balance. Required: ${targetBalance}, available: ${totalBalance}`,
			);
		}

		if (selectedCoins.length === 1) {
			const coin = selectedCoins[0];
			if (coin) {
				return tx.object(coin.coinObjectId);
			}
		}

		const [primaryCoin, ...coinsToMerge] = selectedCoins;
		if (!primaryCoin) {
			throw new Error("No primary coin available");
		}
		const primaryCoinArg = tx.object(primaryCoin.coinObjectId);
		const coinToMergeArgs = coinsToMerge.map((c) => tx.object(c.coinObjectId));

		tx.mergeCoins(primaryCoinArg, coinToMergeArgs);
		return primaryCoinArg;
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
