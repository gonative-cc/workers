import { SuiClient as Client, getFullnodeUrl } from "@mysten/sui/client";
import type { Signer } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction as SuiTransaction } from "@mysten/sui/transactions";
import { Transaction } from "bitcoinjs-lib";
import { serializeBtcTx } from "./btctx-serializer";
import { ProofResult } from "./btcindexer";

export interface SuiClientCfg {
	network: "testnet" | "mainnet" | "devnet";
	nbtcPkg: string;
	nbtcModule: string;
	nbtcObjectId: string;
	lightClientObjectId: string;
	signerMnemonic: string;
}

export class SuiClient {
	private client: Client;
	private signer: Signer;
	private nbtcPkg: string;
	private nbtcModule: string;
	private nbtcObjectId: string;
	private lightClientObjectId: string;

	constructor(config: SuiClientCfg) {
		this.client = new Client({ url: getFullnodeUrl(config.network) });
		// TODO: instead of mnemonic, let's use the Signer interface in the config
		this.signer = Ed25519Keypair.deriveKeypair(config.signerMnemonic);
		this.nbtcPkg = config.nbtcPkg;
		this.nbtcModule = config.nbtcModule;
		this.nbtcObjectId = config.nbtcObjectId;
		this.lightClientObjectId = config.lightClientObjectId;
	}

	async mintNbtc(
		transaction: Transaction,
		blockHeight: number,
		txIndex: number,
		proof: ProofResult,
	): Promise<void> {
		const tx = new SuiTransaction();
		const target = `${this.nbtcPkg}::${this.nbtcModule}::mint` as const;
		const serializedTx = serializeBtcTx(transaction);

		// NOTE: the contract is expecting the proofs to be in little-endian format, while the merkletreejs lib operates internally on big-endian.
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

export default SuiClient;
