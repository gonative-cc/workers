import { SuiClient as Client, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction as SuiTransaction } from "@mysten/sui/transactions";
import { Transaction } from "bitcoinjs-lib";
import { serializeBtcTx } from "./btctx-serializer";
import { ProofResult } from "./btcindexer";

export interface SuiClientConfig {
	suiNetwork: "testnet" | "mainnet" | "devnet";
	suiPackageId: string;
	suiModule: string;
	suiFunction: string;
	suiNbtcObjectId: string;
	suiLightClientObjectId: string;
	suiSignerMnemonic: string;
}

export class SuiClient {
	private client: Client;
	private signer: Ed25519Keypair;
	private packageId: string;
	private module: string;
	private function: string;
	private nbtcObjectId: string;
	private lightClientObjectId: string;

	constructor(config: SuiClientConfig) {
		this.client = new Client({ url: getFullnodeUrl(config.suiNetwork) });
		this.signer = Ed25519Keypair.deriveKeypair(config.suiSignerMnemonic);
		this.packageId = config.suiPackageId;
		this.module = config.suiModule;
		this.function = config.suiFunction;
		this.nbtcObjectId = config.suiNbtcObjectId;
		this.lightClientObjectId = config.suiLightClientObjectId;
	}

	async mintNbtc(
		transaction: Transaction,
		blockHeight: number,
		txIndex: number,
		proof: ProofResult,
	): Promise<void> {
		const tx = new SuiTransaction();
		const target = `${this.packageId}::${this.module}::${this.function}` as const;
		const serializedTx = serializeBtcTx(transaction);

		// NOTE: the contract is expecting the proofs to be in big-endian format, while the bitcon-js lib operates internally on little-endian.
		const proofBigEndian = proof.proofPath.map((p) => Array.from(Buffer.from(p).reverse()));

		tx.moveCall({
			target: target,
			arguments: [
				tx.object(this.nbtcObjectId),
				tx.object(this.lightClientObjectId),
				tx.pure.vector("u8", serializedTx.version),
				tx.pure.u32(serializedTx.inputCount),
				tx.pure.vector("u8", serializedTx.inputs),
				tx.pure.u32(serializedTx.outputCount),
				tx.pure.vector("u8", serializedTx.outputs),
				tx.pure.vector("u8", serializedTx.lockTime),
				tx.pure.vector("vector<u8>", proofBigEndian),
				tx.pure.u64(blockHeight),
				tx.pure.u64(txIndex),
			],
		});

		// TODO: should we move it to config or set it as a constant
		tx.setGasBudget(1000000000);

		const result = await this.client.signAndExecuteTransaction({
			signer: this.signer,
			transaction: tx,
			options: {
				showEffects: true,
			},
		});

		console.log(result.effects);

		if (result.effects?.status.status !== "success") {
			throw new Error(`Mint transaction failed: ${result.effects?.status.error}`);
		}
	}

	async tryMintNbtc(
		transaction: Transaction,
		blockHeight: number,
		txIndex: number,
		proof: ProofResult,
	): Promise<boolean> {
		try {
			await this.mintNbtc(transaction, blockHeight, txIndex, proof);
			return true;
		} catch (error) {
			console.error(`Error during mint contract call`, error);
			return false;
		}
	}
}
