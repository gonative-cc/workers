import { SuiClient as Client, getFullnodeUrl } from "@mysten/sui/client";
import type { Signer } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction as SuiTransaction } from "@mysten/sui/transactions";
import { Transaction } from "bitcoinjs-lib";
import { MintBatchArg, ProofResult, SuiTxDigest } from "./models";
import { toSerializableError } from "./errutils";

export interface SuiClientCfg {
	network: "testnet" | "mainnet" | "devnet" | "localnet";
	nbtcPkg: string;
	nbtcModule: string;
	nbtcObjectId: string;
	lightClientObjectId: string;
	signerMnemonic: string;
}

const NBTC_MODULE = "nbtc";

export async function suiClientFromEnv(env: Env): Promise<SuiClient> {
	return new SuiClient({
		network: env.SUI_NETWORK,
		nbtcPkg: env.SUI_PACKAGE_ID,
		nbtcModule: NBTC_MODULE,
		nbtcObjectId: env.NBTC_OBJECT_ID,
		lightClientObjectId: env.LIGHT_CLIENT_OBJECT_ID,
		signerMnemonic: await env.NBTC_MINTING_SIGNER_MNEMONIC.get(),
	});
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
		console.debug({
			msg: "Sui Client Initialized",
			suiSignerAddress: this.signer.getPublicKey().toSuiAddress(),
			network: config.network,
		});
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

		// NOTE: the contract is expecting the proofs to be in little-endian format, while the merkletreejs lib operates internally on big-endian.
		const proofLittleEndian = proof.proofPath.map((p) => Array.from(Buffer.from(p).reverse()));
		const txBytes = Array.from(transaction.toBuffer());
		tx.moveCall({
			target: target,
			arguments: [
				tx.object(this.nbtcObjectId),
				tx.object(this.lightClientObjectId),
				tx.pure.vector("u8", txBytes),
				tx.pure.vector("vector<u8>", proofLittleEndian),
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
		} catch (e) {
			console.error({
				msg: "Error during single mint contract call",
				error: toSerializableError(e),
				btcTxId: transaction.getId(),
			});
			return false;
		}
	}

	async mintNbtcBatch(mintArgs: MintBatchArg[]): Promise<SuiTxDigest> {
		if (mintArgs.length === 0) throw new Error("Mint arguments cannot be empty.");

		const tx = new SuiTransaction();
		const target = `${this.nbtcPkg}::${this.nbtcModule}::mint` as const;

		for (const args of mintArgs) {
			const proofLittleEndian = args.proof.proofPath.map((p) => Array.from(p)).reverse();
			const txBytes = Array.from(args.tx.toBuffer());

			tx.moveCall({
				target: target,
				arguments: [
					tx.object(this.nbtcObjectId),
					tx.object(this.lightClientObjectId),
					tx.pure.vector("u8", txBytes),
					tx.pure.vector("vector<u8>", proofLittleEndian),
					tx.pure.u64(args.blockHeight),
					tx.pure.u64(args.txIndex),
				],
			});
		}

		tx.setGasBudget(1000000000);

		const result = await this.client.signAndExecuteTransaction({
			signer: this.signer,
			transaction: tx,
			options: { showEffects: true },
		});

		if (result.effects?.status.status !== "success") {
			console.error({
				msg: "Sui batch mint transaction effects indicated failure",
				status: result.effects?.status.status,
				error: result.effects?.status.error,
			});
			throw new Error(`Batch mint transaction failed: ${result.effects?.status.error}`);
		}
		return result.digest;
	}

	async tryMintNbtcBatch(mintArgs: MintBatchArg[]): Promise<SuiTxDigest | null> {
		const txIds = mintArgs.map((arg) => arg.tx.getId());
		try {
			return await this.mintNbtcBatch(mintArgs);
		} catch (e) {
			console.error({
				msg: "Error during batch mint contract call",
				error: toSerializableError(e),
				btcTxIds: txIds,
			});
			return null;
		}
	}
}

export default SuiClient;
