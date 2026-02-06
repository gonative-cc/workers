import { bcs } from "@mysten/bcs";
import { SuiClient as Client, getFullnodeUrl } from "@mysten/sui/client";
import type { Signer } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction as SuiTransaction } from "@mysten/sui/transactions";
import { btcNetworkCfg, type MintBatchArg, type NbtcPkgCfg, type SuiTxDigest } from "./models";
import { logError, logger } from "@gonative-cc/lib/logger";
import { nBTCContractModule } from "@gonative-cc/nbtc";
import { Transaction, payments, script } from "bitcoinjs-lib";
import type { D1Database } from "@cloudflare/workers-types";

const LC_MODULE = "light_client";

export interface SuiClientI {
	verifyBlocks: (blockHashes: string[]) => Promise<boolean[]>;
	mintNbtcBatch: (mintArgs: MintBatchArg[]) => Promise<[boolean, SuiTxDigest]>;
	tryMintNbtcBatch: (mintArgs: MintBatchArg[]) => Promise<[boolean, SuiTxDigest] | null>;
	getMintedTxsTableId: () => Promise<string>;
}

export type SuiClientConstructor = (config: NbtcPkgCfg) => SuiClientI;

export function NewSuiClient(mnemonic: string, db: D1Database): SuiClientConstructor {
	return (config: NbtcPkgCfg) => new SuiClient(config, mnemonic, db);
}

export class SuiClient implements SuiClientI {
	private client: Client;
	private signer: Signer;
	private config: NbtcPkgCfg;
	private db: D1Database;

	constructor(config: NbtcPkgCfg, mnemonic: string, db?: D1Database) {
		this.config = config;
		this.client = new Client({ url: getFullnodeUrl(config.sui_network) });
		// TODO: instead of mnemonic, let's use the Signer interface in the config
		this.signer = Ed25519Keypair.deriveKeypair(mnemonic);
		this.db = db!;
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

	async getMintedTxsTableId(): Promise<string> {
		const result = await this.client.getObject({
			id: this.config.nbtc_contract,
			options: { showContent: true },
		});
		if (result.error || !result.data) {
			throw new Error(`Failed to fetch NbtcContract object: ${result.error?.code}`);
		}

		const content = result.data.content;
		if (!content || content.dataType !== "moveObject") {
			throw new Error("NbtcContract object content is missing or not a moveObject");
		}

		const fields = content.fields as Record<string, unknown>;
		const txIdsTable = fields.tx_ids as { fields?: { id?: { id?: string } } } | undefined;
		if (
			!txIdsTable ||
			!txIdsTable.fields ||
			!txIdsTable.fields.id ||
			!txIdsTable.fields.id.id
		) {
			throw new Error("Failed to extract tx_ids table ID from NbtcContract object");
		}

		return txIdsTable.fields.id.id;
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

		for (const args of mintArgs) {
			const proofLittleEndian = args.proof.proofPath.map((p) => Array.from(p));
			const txBytes = Array.from(args.tx.toBuffer());

			// Extract sender address and check sanctions
			const senderAddress = await this.extractSenderAddress(args.tx);
			if (senderAddress && (await this.isSanctioned(senderAddress))) {
				logger.error({
					msg: "Sanctioned address detected, skipping mint",
					txId: args.tx.getId(),
					senderAddress,
				});
				continue;
			}

			tx.add(
				nBTCContractModule.mint({
					package: this.config.nbtc_pkg,
					arguments: {
						contract: this.config.nbtc_contract,
						lightClient: this.config.lc_contract,
						txBytes: txBytes,
						proof: proofLittleEndian,
						height: args.blockHeight,
						txIndex: args.txIndex,
						payload: [],
						opsArg: 1,
					},
				}),
			);
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

	private async extractSenderAddress(tx: Transaction): Promise<string | null> {
		try {
			if (tx.ins.length === 0) return null;

			const firstInput = tx.ins[0];
			const network = btcNetworkCfg[this.config.btc_network];

			if (firstInput && firstInput.witness && firstInput.witness.length >= 2) {
				const pubKey = firstInput.witness[1];
				const { address } = payments.p2wpkh({
					pubkey: pubKey,
					network: network,
				});
				return address || null;
			}

			const scriptSig = firstInput?.script;
			if (scriptSig && scriptSig.length >= 65) {
				const chunks = script.decompile(scriptSig);
				if (!chunks) return null;

				const pubKey = chunks[chunks.length - 1] as Buffer;

				const { address } = payments.p2pkh({
					pubkey: pubKey,
					network: network,
				});
				return address || null;
			}

			return null;
		} catch (e) {
			logError(
				{
					method: "extractSenderAddress",
					msg: "Failed to extract sender address",
				},
				e,
			);
			return null;
		}
	}

	private async isSanctioned(btcAddress: string): Promise<boolean> {
		try {
			const result = await this.db
				.prepare(
					"SELECT 1 FROM SanctionedCryptoAddresses WHERE wallet_address = ? AND address_type = 'BTC'",
				)
				.bind(btcAddress)
				.first();
			return result !== null;
		} catch (e) {
			logError({ method: "isSanctioned", msg: "Failed to check sanctions", btcAddress }, e);
			return false;
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
