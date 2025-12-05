import { bcs } from "@mysten/bcs";
import { SuiClient as Client, getFullnodeUrl } from "@mysten/sui/client";
import type { Signer } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction as SuiTransaction } from "@mysten/sui/transactions";
import type { MintBatchArg, NbtcPkgCfg, SuiTxDigest } from "./models";
import { logError, logger } from "@gonative-cc/lib/logger";

const NBTC_MODULE = "nbtc";
const LC_MODULE = "light_client";

export interface SuiClientI {
	verifyBlocks: (blockHashes: string[]) => Promise<boolean[]>;
	mintNbtcBatch: (mintArgs: MintBatchArg[]) => Promise<[boolean, SuiTxDigest]>;
	tryMintNbtcBatch: (mintArgs: MintBatchArg[]) => Promise<[boolean, SuiTxDigest] | null>;
}

export type SuiClientConstructor = (config: NbtcPkgCfg) => SuiClientI;

export function NewSuiClient(mnemonic: string): SuiClientConstructor {
	return (config: NbtcPkgCfg) => new SuiClient(config, mnemonic);
}

export class SuiClient implements SuiClientI {
	private client: Client;
	private signer: Signer;
	private config: NbtcPkgCfg;

	constructor(config: NbtcPkgCfg, mnemonic: string) {
		this.config = config;
		this.client = new Client({ url: getFullnodeUrl(config.sui_network) });
		// TODO: instead of mnemonic, let's use the Signer interface in the config
		this.signer = Ed25519Keypair.deriveKeypair(mnemonic);
		logger.debug({
			msg: "Sui Client Initialized",
			suiSignerAddress: this.signer.getPublicKey().toSuiAddress(),
			network: config.sui_network,
		});
	}

	async verifyBlocks(blockHashes: string[]): Promise<boolean[]> {
		const tx = new SuiTransaction();
		const target = `${this.config.lc_pkg}::${LC_MODULE}::verify_blocks` as const;
		tx.moveCall({
			target: target,
			arguments: [
				tx.object(this.config.lc_contract),
				tx.pure.vector(
					"vector<u8>",
					blockHashes.map((h) =>
						// The block hash from bitcoinjs-lib getId() its in reversed byte order,
						// The spv contract expects the hash in natural byte order,
						// thats why we use reverse here.
						Array.from(Buffer.from(h, "hex").reverse()),
					),
				),
			],
		});
		const result = await this.client.devInspectTransactionBlock({
			sender: this.signer.getPublicKey().toSuiAddress(),
			transactionBlock: tx,
		});
		if (result.effects.status.status !== "success") {
			throw new Error(`Transaction failed: ${result.effects.status.error}`);
		}

		const returnValues = result.results?.[0]?.returnValues;
		if (!returnValues || returnValues.length === 0) {
			throw new Error("No return values from devInspectTransactionBlock");
		}
		// The return value is a BCS-encoded vector<bool>.
		const firstReturnValue = returnValues[0];
		if (!firstReturnValue) {
			throw new Error("No return values from devInspectTransactionBlock");
		}
		const bytes = firstReturnValue[0];
		if (!bytes) {
			throw new Error("No return values from devInspectTransactionBlock");
		}
		return bcs.vector(bcs.bool()).parse(Uint8Array.from(bytes));
	}

	/**
	 * Executes a batch mint transaction on Sui.
	 * Returns [success, digest] tuple:
	 * - [true, digest]: Transaction executed successfully on-chain
	 * - [false, digest]: Transaction executed but failed on-chain
	 * Throws on pre-submission errors
	 */
	async mintNbtcBatch(mintArgs: MintBatchArg[]): Promise<[boolean, SuiTxDigest]> {
		if (mintArgs.length === 0) throw new Error("Mint arguments cannot be empty.");

		// Assuming all mintArgs in a batch are for the same nbtcPkg and suiNetwork for now
		const firstArg = mintArgs[0];
		if (!firstArg) throw new Error("Mint arguments cannot be empty.");

		const tx = new SuiTransaction();
		const target = `${this.config.nbtc_pkg}::${NBTC_MODULE}::mint` as const; // Use nbtcPkg from arg

		for (const args of mintArgs) {
			const proofLittleEndian = args.proof.proofPath.map((p) => Array.from(p));
			const txBytes = Array.from(args.tx.toBuffer());

			tx.moveCall({
				target: target,
				arguments: [
					tx.object(this.config.nbtc_contract),
					tx.object(this.config.lc_contract),
					tx.pure.vector("u8", txBytes),
					tx.pure.vector("vector<u8>", proofLittleEndian),
					tx.pure.u64(args.blockHeight),
					tx.pure.u64(args.txIndex),
					tx.pure.vector("u8", []),
					tx.pure.u32(1),
				],
			});
		}

		tx.setGasBudget(1000000000);

		const result = await this.client.signAndExecuteTransaction({
			signer: this.signer,
			transaction: tx,
			options: { showEffects: true },
		});

		const success = result.effects?.status.status === "success";

		if (!success) {
			logger.error({
				msg: "Sui batch mint transaction effects indicated failure",
				status: result.effects?.status.status,
				error: result.effects?.status.error,
				digest: result.digest,
			});
		}

		return [success, result.digest];
	}

	/**
	 * Wrapper for mintNbtcBatch that catches pre-submission errors.
	 * Returns:
	 * - [true, digest]: Success
	 * - [false, digest]: On-chain failure
	 * - null: Pre-submission error
	 */
	async tryMintNbtcBatch(mintArgs: MintBatchArg[]): Promise<[boolean, SuiTxDigest] | null> {
		const txIds = mintArgs.map((arg) => arg.tx.getId());
		try {
			return await this.mintNbtcBatch(mintArgs);
		} catch (e) {
			logError(
				{
					msg: "Error during batch mint contract call",
					method: "tryMintNbtcBatch",
					btcTxIds: txIds,
				},
				e,
			);
			return null;
		}
	}
}

export default SuiClient;
