import { bcs } from "@mysten/bcs";
import { SuiClient as Client, getFullnodeUrl } from "@mysten/sui/client";
import type { Signer } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction as SuiTransaction } from "@mysten/sui/transactions";
import type { MintBatchArg, SuiTxDigest } from "./models";
import { toSerializableError } from "./errutils";

export interface SuiClientCfg {
	network: "testnet" | "mainnet" | "devnet" | "localnet";
	nbtcPkg: string;
	nbtcModule: string;
	nbtcContractId: string;
	lightClientObjectId: string;
	lightClientPackageId: string;
	lightClientModule: string;
	signerMnemonic: string;
}

const NBTC_MODULE = "nbtc";
const LC_MODULE = "light_client";

export async function suiClientFromEnv(env: Env): Promise<SuiClient> {
	return new SuiClient({
		network: env.SUI_NETWORK,
		nbtcPkg: env.NBTC_PACKAGE_ID,
		nbtcModule: NBTC_MODULE,
		nbtcContractId: env.NBTC_CONTRACT_ID,
		lightClientObjectId: env.LIGHT_CLIENT_OBJECT_ID,
		lightClientPackageId: env.LIGHT_CLIENT_PACKAGE_ID,
		lightClientModule: LC_MODULE,
		signerMnemonic: await env.NBTC_MINTING_SIGNER_MNEMONIC.get(),
	});
}

export class SuiClient {
	private client: Client;
	private signer: Signer;
	private nbtcPkg: string;
	private nbtcModule: string;
	private nbtcContractId: string;
	private lightClientObjectId: string;
	private lightClientPackageId: string;
	private lightClientModule: string;

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
		this.nbtcContractId = config.nbtcContractId;
		this.lightClientObjectId = config.lightClientObjectId;
		this.lightClientPackageId = config.lightClientPackageId;
		this.lightClientModule = config.lightClientModule;
	}

	async verifyBlocks(blockHashes: string[]): Promise<boolean[]> {
		const tx = new SuiTransaction();
		const target =
			`${this.lightClientPackageId}::${this.lightClientModule}::verify_blocks` as const;
		tx.moveCall({
			target: target,
			arguments: [
				tx.object(this.lightClientObjectId),
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
		if (firstReturnValue === undefined || firstReturnValue[0] === undefined) {
			throw new Error("Invalid return value from devInspectTransactionBlock");
		}
		const bytes = firstReturnValue[0];
		return bcs.vector(bcs.bool()).parse(Uint8Array.from(bytes));
	}

	async mintNbtcBatch(mintArgs: MintBatchArg[]): Promise<SuiTxDigest> {
		if (mintArgs.length === 0) throw new Error("Mint arguments cannot be empty.");

		// Assuming all mintArgs in a batch are for the same nbtc_pkg and sui_network for now
		const firstArg = mintArgs[0];
		if (!firstArg) throw new Error("Mint arguments cannot be empty.");

		const tx = new SuiTransaction();
		const target = `${firstArg.nbtc_pkg}::${this.nbtcModule}::mint` as const; // Use nbtc_pkg from arg

		for (const args of mintArgs) {
			const proofLittleEndian = args.proof.proofPath.map((p) => Array.from(p));
			const txBytes = Array.from(args.tx.toBuffer());

			tx.moveCall({
				target: target,
				arguments: [
					tx.object(this.nbtcContractId),
					tx.object(this.lightClientObjectId),
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
