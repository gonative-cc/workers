import { SuiClient as Client, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction as SuiTransaction } from "@mysten/sui/transactions";
import { Transaction } from "bitcoinjs-lib";
import { serializeBtcTx } from "./btctx-serializer";
import { ProofResult } from "./btcindexer";

export interface SuiClientConfig {
	suiNetwork: "testnet" | "mainnet" | "devnet";
	suiPackageId: string;
	suiNbtcObjectId: string;
	suiLightClientObjectId: string;
	suiSignerMnemonic: string;
}

export class SuiClient {
	private client: Client;
	private signer: Ed25519Keypair;
	private packageId: string;
	private nbtcObjectId: string;
	private lightClientObjectId: string;

	constructor(config: SuiClientConfig) {
		this.client = new Client({ url: getFullnodeUrl(config.suiNetwork) });
		this.signer = Ed25519Keypair.deriveKeypair(config.suiSignerMnemonic);
		this.packageId = config.suiPackageId;
		this.nbtcObjectId = config.suiNbtcObjectId;
		this.lightClientObjectId = config.suiLightClientObjectId;
	}

	async mintNbtc(
		transaction: Transaction,
		blockHeight: number,
		txIndex: number,
		proof: ProofResult,
	): Promise<boolean> {
		try {
			const tx = new SuiTransaction();
			const target = `${this.packageId}::nbtc::mint` as const;
			const serializedTx = serializeBtcTx(transaction);

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
					tx.pure.vector(
						"vector<u8>",
						proof.proofPath.map((p) => Array.from(p)),
					),
					tx.pure.u64(blockHeight),
					tx.pure.u64(txIndex),
				],
			});

			const result = await this.client.signAndExecuteTransaction({
				signer: this.signer,
				transaction: tx,
				options: {
					showEffects: true,
				},
			});

			if (result.effects?.status.status === "success") {
				console.log(`Mint successful. Digest: ${result.digest}`);
				return true;
			} else {
				console.error(
					`Mint failed. Digest: ${result.digest}:`,
					result.effects?.status.error,
				);
				return false;
			}
		} catch (error) {
			console.error(`Error during mint call`, error);
			return false;
		}
	}
}
