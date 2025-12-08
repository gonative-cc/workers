import { bcs } from "@mysten/bcs";
import { SuiClient as Client, getFullnodeUrl } from "@mysten/sui/client";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { graphql } from "@mysten/sui/graphql/schemas/latest";
import type { Signer } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction as SuiTransaction } from "@mysten/sui/transactions";
import type { MintBatchArg, NbtcPkgCfg, SuiTxDigest } from "./models";
import { logError, logger } from "@gonative-cc/lib/logger";
import { SUI_GRAPHQL_URLS } from "@gonative-cc/lib/nsui";

const CHECK_DYNAMIC_FIELD_QUERY = graphql(`
	query CheckDynamicField($parentId: SuiAddress!, $name: DynamicFieldName!) {
		address(address: $parentId) {
			dynamicField(name: $name) {
				name {
					json
				}
			}
		}
	}
`);

const GET_TX_IDS_TABLE_QUERY = graphql(`
	query GetTxIdsTable($contractId: SuiAddress!) {
		object(address: $contractId) {
			asMoveObject {
				contents {
					json
				}
			}
		}
	}
`);

const NBTC_MODULE = "nbtc";
const LC_MODULE = "light_client";

export interface SuiClientI {
	verifyBlocks: (blockHashes: string[]) => Promise<boolean[]>;
	mintNbtcBatch: (mintArgs: MintBatchArg[]) => Promise<[boolean, SuiTxDigest]>;
	tryMintNbtcBatch: (mintArgs: MintBatchArg[]) => Promise<[boolean, SuiTxDigest] | null>;
	isBtcTxMinted: (btcTxId: string) => Promise<boolean>;
}

export type SuiClientConstructor = (config: NbtcPkgCfg) => SuiClientI;

export function NewSuiClient(mnemonic: string): SuiClientConstructor {
	return (config: NbtcPkgCfg) => new SuiClient(config, mnemonic);
}

export class SuiClient implements SuiClientI {
	private client: Client;
	private gqlClient: SuiGraphQLClient;
	private signer: Signer;
	private config: NbtcPkgCfg;
	private txIdsTableIdCache: string | null = null;

	constructor(config: NbtcPkgCfg, mnemonic: string) {
		this.config = config;
		this.client = new Client({ url: getFullnodeUrl(config.sui_network) });
		const gqlUrl = SUI_GRAPHQL_URLS[config.sui_network];
		this.gqlClient = new SuiGraphQLClient({ url: gqlUrl });
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
		const target = `${this.config.nbtc_pkg}::${NBTC_MODULE}::mint` as const;

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
	 * Gets the table ID for storing minted BTC transaction IDs from the nBTC contract.
	 * Caches the result to avoid repeated queries.
	 */
	private async getTxIdsTableId(): Promise<string> {
		if (this.txIdsTableIdCache) {
			return this.txIdsTableIdCache;
		}

		try {
			const result = await this.gqlClient.query({
				query: GET_TX_IDS_TABLE_QUERY,
				variables: {
					contractId: this.config.nbtc_contract,
				},
			});

			const json = result.data?.object?.asMoveObject?.contents?.json;
			if (json && typeof json === "object" && "tx_ids" in json) {
				const txIds = json.tx_ids as { id: string };
				this.txIdsTableIdCache = txIds.id;
				return txIds.id;
			}

			throw new Error("Could not find tx_ids table in contract");
		} catch (e) {
			logError(
				{
					msg: "Failed to get tx_ids table ID from contract",
					method: "SuiClient.getTxIdsTableId",
					contractId: this.config.nbtc_contract,
				},
				e,
			);
			throw e;
		}
	}

	async isBtcTxMinted(btcTxId: string): Promise<boolean> {
		try {
			const txIdsTableId = await this.getTxIdsTableId();
			const txIdBytes = Buffer.from(btcTxId, "hex").reverse();
			const bcsEncoded = bcs.vector(bcs.u8()).serialize(Array.from(txIdBytes)).toBytes();
			const bcsBase64 = Buffer.from(bcsEncoded).toString("base64");

			const result = await this.gqlClient.query({
				query: CHECK_DYNAMIC_FIELD_QUERY,
				variables: {
					parentId: txIdsTableId,
					name: {
						type: "vector<u8>",
						bcs: bcsBase64,
					},
				},
			});
			return result.data?.address?.dynamicField != null;
		} catch (e: unknown) {
			const isNotFoundError =
				e &&
				typeof e === "object" &&
				"message" in e &&
				typeof e.message === "string" &&
				e.message.toLowerCase().includes("not found");

			if (isNotFoundError) {
				return false;
			}
			logError(
				{
					msg: "Failed to check if BTC tx is minted",
					method: "SuiClient.isBtcTxMinted",
					btcTxId,
				},
				e,
			);
			throw e;
		}
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
