import { address, networks, Block, Transaction, type Network } from "bitcoinjs-lib";
import {
	BtcNet,
	type BlockQueueRecord,
	calculateConfirmations,
	btcNetFromString,
} from "@gonative-cc/lib/nbtc";
import type { SuiNet } from "@gonative-cc/lib/nsui";
import { SUI_GRAPHQL_URLS } from "@gonative-cc/lib/nsui";
import type { Service } from "@cloudflare/workers-types";
import type { WorkerEntrypoint } from "cloudflare:workers";
import {
	type SuiIndexerRpc,
	RedeemRequestStatus,
	type ConfirmingRedeemReq,
	type FinalizeRedeemTx,
} from "@gonative-cc/sui-indexer/rpc-interface";
import { logError, logger } from "@gonative-cc/lib/logger";
import { getMnemonic } from "@gonative-cc/lib/secrets";
import { isValidSuiAddress } from "@mysten/sui/utils";
import { OP_RETURN } from "./opcodes";
import { BitcoinMerkleTree } from "./bitcoin-merkle-tree";
import { SuiClient, type SuiClientI } from "./sui_client";
import { SuiGraphQLClient } from "./graphql-client";
import type {
	Deposit,
	PendingTx,
	NbtcTxResp,
	MintBatchArg,
	FinalizedTxRow,
	NbtcTxRow,
	NbtcTxInsertion,
	ProcessedKey,
	PreparedMintBatches,
	ElectrsTxResponse,
	NbtcPkgCfg,
	NbtcDepositAddrsMap,
} from "./models";
import { MintTxStatus, InsertBlockStatus } from "./models";
import type { Electrs } from "./electrs";
import { ElectrsService, ELECTRS_URLS_BY_NETWORK } from "./electrs";
import { fetchNbtcAddresses, fetchPackageConfigs, type Storage } from "./storage";
import { CFStorage } from "./cf-storage";
import type { PutNbtcTxResponse } from "./rpc-interface";

const btcNetworkCfg: Record<BtcNet, Network> = {
	[BtcNet.MAINNET]: networks.bitcoin,
	[BtcNet.TESTNET]: networks.testnet,
	[BtcNet.REGTEST]: networks.regtest,
	[BtcNet.SIGNET]: networks.testnet,
};

interface ConfirmingTxCandidate<T> {
	id: string | number;
	blockHeight: number;
	blockHash: string;
	network: BtcNet;
	original: T;
}

export async function indexerFromEnv(env: Env): Promise<Indexer> {
	const storage = new CFStorage(env.DB, env.BtcBlocks, env.nbtc_txs);

	const nbtcDepositAddrMap = await fetchNbtcAddresses(env.DB);
	const packageConfigs = await fetchPackageConfigs(env.DB);

	const confirmationDepth = parseInt(env.CONFIRMATION_DEPTH || "8", 10);
	if (isNaN(confirmationDepth) || confirmationDepth < 1) {
		throw new Error("Invalid CONFIRMATION_DEPTH in config. Must be a number greater than 0.");
	}

	const maxNbtcMintTxRetries = parseInt(env.MAX_NBTC_MINT_TX_RETRIES || "1", 10);
	if (isNaN(maxNbtcMintTxRetries) || maxNbtcMintTxRetries < 0) {
		throw new Error("Invalid MAX_NBTC_MINT_TX_RETRIES in config. Must be a number >= 0.");
	}

	const mnemonic = await getMnemonic(env.NBTC_MINTING_SIGNER_MNEMONIC);
	if (!mnemonic) {
		throw new Error("Failed to retrieve mnemonic");
	}
	const suiClients = new Map<SuiNet, SuiClient>();
	for (const p of packageConfigs) {
		if (!suiClients.has(p.sui_network))
			suiClients.set(p.sui_network, new SuiClient(p, mnemonic));
	}

	const electrsClients = new Map<BtcNet, ElectrsService>();
	for (const net in ELECTRS_URLS_BY_NETWORK) {
		const url = ELECTRS_URLS_BY_NETWORK[net as BtcNet];
		if (url) electrsClients.set(net as BtcNet, new ElectrsService(url));
	}

	try {
		return new Indexer(
			storage,
			packageConfigs,
			suiClients,
			nbtcDepositAddrMap,
			confirmationDepth,
			maxNbtcMintTxRetries,
			electrsClients,
			env.SuiIndexer as unknown as Service<SuiIndexerRpc & WorkerEntrypoint>,
		);
	} catch (err) {
		logError({ msg: "Can't create btcindexer", method: "Indexer.constructor" }, err);
		throw err;
	}
}

export class Indexer {
	storage: Storage;
	confirmationDepth: number;
	maxNbtcMintTxRetries: number;
	nbtcDepositAddrMap: NbtcDepositAddrsMap;
	#packageConfigs: Map<number, NbtcPkgCfg>; // nbtc pkg id -> pkg config
	#suiClients: Map<SuiNet, SuiClientI>;
	#electrsClients: Map<BtcNet, Electrs>;
	suiIndexer: Service<SuiIndexerRpc & WorkerEntrypoint>;

	constructor(
		storage: Storage,
		packageConfigs: NbtcPkgCfg[],
		suiClients: Map<SuiNet, SuiClientI>,
		nbtcDepositAddrMap: NbtcDepositAddrsMap,
		confirmationDepth: number,
		maxRetries: number,
		electrsClients: Map<BtcNet, Electrs>,
		suiIndexer: Service<SuiIndexerRpc & WorkerEntrypoint>,
	) {
		if (packageConfigs.length === 0) {
			throw new Error("No active nBTC packages configured.");
		}
		if (nbtcDepositAddrMap.size === 0) {
			throw new Error("No nBTC deposit addresses configured.");
		}
		for (const p of packageConfigs) {
			if (!suiClients.has(p.sui_network))
				throw new Error("No SuiClient configured for network " + p.sui_network);
		}
		for (const p of packageConfigs) {
			if (!electrsClients.has(p.btc_network as BtcNet)) {
				throw new Error("No Electrs client configured for network " + p.btc_network);
			}
		}
		const pkgCfgMap = new Map(packageConfigs.map((c) => [c.id, c]));

		for (const n of nbtcDepositAddrMap) {
			if (!pkgCfgMap.has(n[1].setup_id))
				throw new Error("No nBTC package config found for bitcoin address " + n[0]);
		}

		this.storage = storage;
		this.nbtcDepositAddrMap = nbtcDepositAddrMap;
		this.confirmationDepth = confirmationDepth;
		this.maxNbtcMintTxRetries = maxRetries;
		this.#electrsClients = electrsClients;
		this.#packageConfigs = pkgCfgMap;
		this.#suiClients = suiClients;
		this.suiIndexer = suiIndexer;
	}

	async hasNbtcMintTx(txId: string): Promise<boolean> {
		const existingTx = await this.storage.getNbtcMintTx(txId);
		return existingTx !== null;
	}

	getSuiClient(suiNet: SuiNet): SuiClientI {
		const c = this.#suiClients.get(suiNet);
		if (c === undefined) throw new Error("No SuiClient for the sui network = " + suiNet);
		return c;
	}

	getElectrsClient(btcNet: BtcNet): Electrs {
		const client = this.#electrsClients.get(btcNet);
		if (!client) {
			throw new Error(`No Electrs client configured for network ${btcNet}`);
		}
		return client;
	}

	// Query NbtcPkgCfg by db table row ID.
	getPackageConfig(nbtcPkgId: number): NbtcPkgCfg {
		const c = this.#packageConfigs.get(nbtcPkgId);
		if (c === undefined) throw new Error("No Nbtc pkg for pkg_id = " + nbtcPkgId);
		return c;
	}

	// - extracts and processes nBTC deposit transactions in the block
	// - handles reorgs
	async processBlock(
		blockInfo: BlockQueueRecord,
		trackedRedeems: Set<string> = new Set<string>(),
	): Promise<void> {
		const { block, network } = await this.prepareBlock(blockInfo);
		const shouldProcess = await this.registerBlock(blockInfo);
		if (!shouldProcess) return;

		const { deposits, nbtcRedeems } = await this.scanBlockTransactions(
			block,
			network,
			blockInfo,
			trackedRedeems,
		);
		await this.saveDeposits(deposits);
		await this.confirmNbtcRedeems(nbtcRedeems, blockInfo);
		await this.finalizeBlock(blockInfo);
	}

	// fetches raw block data and validates the network
	private async prepareBlock(
		blockInfo: BlockQueueRecord,
	): Promise<{ block: Block; network: Network }> {
		const network = btcNetworkCfg[blockInfo.network];
		if (!network) {
			throw new Error(`Unknown network: ${blockInfo.network}`);
		}
		logger.info({
			msg: "Processing block from queue",
			height: blockInfo.height,
			hash: blockInfo.hash,
			network: blockInfo.network,
		});
		const rawBlockBuffer = await this.storage.getBlock(blockInfo.hash);
		if (!rawBlockBuffer) {
			throw new Error(`Block data not found in KV for hash: ${blockInfo.hash}`);
		}
		const block = Block.fromBuffer(Buffer.from(rawBlockBuffer));
		return { block, network };
	}

	// registers a block and checks for reorgs
	private async registerBlock(blockInfo: BlockQueueRecord): Promise<boolean> {
		const result = await this.storage.insertBlockInfo(blockInfo);
		if (result === InsertBlockStatus.Skipped) {
			logger.debug({
				msg: "Skipping: block already processed",
				method: "Indexer.processBlock",
				height: blockInfo.height,
				hash: blockInfo.hash,
				status: result,
			});
			return false;
		}

		if (result === InsertBlockStatus.Updated) {
			logger.info({
				msg: "Reorg detected, calling detectMintedReorgs",
				height: blockInfo.height,
				hash: blockInfo.hash,
				status: result,
			});
			await this.detectMintedReorgs(blockInfo.height);
		}
		return true;
	}

	// iterates through block txs and checks for minting and tracked redeems.
	// The nbtcRedeems (confirmed Redeems) is a list of detected Bitcoin tx ids.
	private async scanBlockTransactions(
		block: Block,
		network: Network,
		blockInfo: BlockQueueRecord,
		trackedRedeems: Set<string>,
	): Promise<{ deposits: NbtcTxInsertion[]; nbtcRedeems: string[] }> {
		const deposits: NbtcTxInsertion[] = [];
		const nbtcRedeems: string[] = [];

		for (const tx of block.transactions ?? []) {
			const txDeposits = await this.detectMintingTx(tx, network, blockInfo);
			if (txDeposits.length > 0) {
				deposits.push(...txDeposits);
			}

			if (this.detectRedeemTx(tx, trackedRedeems)) {
				nbtcRedeems.push(tx.getId());
			}
		}

		return { deposits, nbtcRedeems };
	}

	// checks if a transaction is a valid nBTC deposit and fetches sender information
	private async detectMintingTx(
		tx: Transaction,
		network: Network,
		blockInfo: BlockQueueRecord,
	): Promise<NbtcTxInsertion[]> {
		const foundDeposits = this.findNbtcDeposits(tx, network);
		if (foundDeposits.length === 0) {
			return [];
		}

		const txSenders = await this.getSenderAddresses(tx, blockInfo.network);
		const sender = txSenders[0] || ""; // Use first sender or empty string if none found
		if (txSenders.length > 1) {
			logger.warn({
				msg: "Multiple senders found for tx, using first one",
				txId: tx.getId(),
				senders: txSenders,
			});
		}

		const results: NbtcTxInsertion[] = [];
		for (const deposit of foundDeposits) {
			logger.info({
				msg: "Found new nBTC deposit",
				txId: tx.getId(),
				vout: deposit.vout,
				amount: deposit.amount,
				suiRecipient: deposit.suiRecipient,
				nbtcPkg: deposit.nbtcPkg,
				suiNetwork: deposit.suiNetwork,
				depositAddress: deposit.depositAddress,
				sender,
			});

			results.push({
				txId: tx.getId(),
				vout: deposit.vout,
				blockHash: blockInfo.hash,
				blockHeight: blockInfo.height,
				suiRecipient: deposit.suiRecipient,
				amount: deposit.amount,
				btcNetwork: blockInfo.network,
				nbtcPkg: deposit.nbtcPkg,
				suiNetwork: deposit.suiNetwork,
				depositAddress: deposit.depositAddress,
				sender,
			});
		}
		return results;
	}

	// verifies if a transaction ID is present in the tracked redeems set
	private detectRedeemTx(tx: Transaction, trackedRedeems: Set<string>): boolean {
		const txId = tx.getId();
		return trackedRedeems.has(txId);
	}

	// saves newly detected deposits to the database
	private async saveDeposits(deposits: NbtcTxInsertion[]): Promise<void> {
		if (deposits.length > 0) {
			await this.storage.insertOrUpdateNbtcTxs(deposits);
		} else {
			logger.debug({ msg: "No new nBTC deposits found in block" });
		}
	}

	// calls the Sui Indexer to update the status of the redeems to 'Confirming'
	private async confirmNbtcRedeems(
		confirmedRedeems: string[],
		blockInfo: BlockQueueRecord,
	): Promise<void> {
		if (confirmedRedeems.length > 0) {
			await this.suiIndexer.confirmRedeem(confirmedRedeems, blockInfo.height, blockInfo.hash);
		}
	}

	// marks the block as processed and updates the local chain tip
	private async finalizeBlock(blockInfo: BlockQueueRecord): Promise<void> {
		await this.storage.markBlockAsProcessed(blockInfo.hash, blockInfo.network);
		await this.storage.setChainTip(blockInfo.height, blockInfo.network);
	}

	findNbtcDeposits(tx: Transaction, network: networks.Network): Deposit[] {
		const deposits: Deposit[] = [];
		let suiRecipient: string | null = null;

		for (const vout of tx.outs) {
			const parsedRecipient = parseSuiRecipientFromOpReturn(vout.script);
			if (parsedRecipient) {
				suiRecipient = parsedRecipient;
				logger.debug({
					msg: "Parsed Sui recipient from OP_RETURN",
					txId: tx.getId(),
					suiRecipient,
				});
				break; // valid tx should have only one OP_RETURN
			}
		}

		for (let i = 0; i < tx.outs.length; i++) {
			const vout = tx.outs[i];
			if (!vout) {
				continue;
			}
			if (vout.script && vout.script[0] === OP_RETURN) {
				continue;
			}
			try {
				const btcAddress = address.fromOutputScript(vout.script, network);
				const pkgId = this.nbtcDepositAddrMap.get(btcAddress)?.setup_id;
				if (pkgId === undefined) continue;
				const config = this.getPackageConfig(pkgId);

				logger.debug({
					msg: "Found matching nBTC deposit output",
					txId: tx.getId(),
					vout: i,
				});
				let finalRecipient = suiRecipient;
				if (!finalRecipient) {
					finalRecipient = config.nbtc_fallback_addr;
				}

				deposits.push({
					vout: i,
					amount: Number(vout.value),
					suiRecipient: finalRecipient,
					nbtcPkg: config.nbtc_pkg,
					suiNetwork: config.sui_network,
					depositAddress: btcAddress,
				});
				// NOTE: "First Match Wins" policy.
				// We stop scanning outputs after finding the first valid deposit.
				// This ensures we strictly return 1 deposit per transaction.
				return deposits;
			} catch (e) {
				// This is expected for coinbase transactions and other non-standard scripts.
				logger.debug({
					msg: "Error parsing output script",
					error: e instanceof Error ? e.message : String(e),
				});
			}
		}
		return deposits;
	}

	// Orchestrates the minting process for finalized transactions.
	async processFinalizedTransactions(): Promise<void> {
		const finalizedTxs = await this.storage.getNbtcMintCandidates(this.maxNbtcMintTxRetries);

		if (!finalizedTxs || finalizedTxs.length === 0) {
			return;
		}

		const txsToProcess = await this.filterAlreadyMinted(finalizedTxs);

		if (txsToProcess.length === 0) {
			logger.info({ msg: "No new deposits to process after front-run check" });
			return;
		}

		logger.info({
			msg: "Minting: Found deposits to process",
			count: txsToProcess.length,
		});

		const txsByBlock = this.groupTransactionsByBlock(txsToProcess);
		const { batches } = await this.prepareMintBatches(txsByBlock);
		await this.executeMintBatches(batches);
	}

	// Filters out txs that have already been minted on-chain and updates the database (front-run detection).
	private async filterAlreadyMinted(finalizedTxs: FinalizedTxRow[]): Promise<FinalizedTxRow[]> {
		const txsBySetupId = new Map<number, FinalizedTxRow[]>();
		for (const tx of finalizedTxs) {
			const list = txsBySetupId.get(tx.setup_id) || [];
			list.push(tx);
			txsBySetupId.set(tx.setup_id, list);
		}

		const txsToProcess: FinalizedTxRow[] = [];

		for (const [setupId, txs] of txsBySetupId) {
			try {
				const config = this.getPackageConfig(setupId);
				const suiClient = this.getSuiClient(config.sui_network);
				const tableId = await suiClient.getMintedTxsTableId();

				const graphqlUrl = SUI_GRAPHQL_URLS[config.sui_network];
				if (!graphqlUrl) {
					logger.warn({ msg: "No GraphQL URL for network", network: config.sui_network });
					txsToProcess.push(...txs);
					continue;
				}

				const graphqlClient = new SuiGraphQLClient(graphqlUrl);
				const txIds = txs.map((t) => t.tx_id);
				const mintedTxIds = await graphqlClient.checkMintedStatus(tableId, txIds);

				for (const tx of txs) {
					if (mintedTxIds.has(tx.tx_id)) {
						logger.info({
							msg: "Front-run detected: Transaction already minted",
							txId: tx.tx_id,
						});
						await this.storage.batchUpdateNbtcMintTxs([
							{
								txId: tx.tx_id,
								vout: tx.vout,
								status: MintTxStatus.Minted,
							},
						]);
					} else {
						txsToProcess.push(tx);
					}
				}
			} catch (e) {
				logError(
					{
						msg: "Error checking pre-mint status via GraphQL",
						method: "filterAlreadyMinted",
						setupId,
					},
					e,
				);
				txsToProcess.push(...txs);
			}
		}

		return txsToProcess;
	}

	/**
	 * Groups a list of blockchain transactions (or any object containing a block_hash) by their block hash.
	 * This optimization allows fetching and parsing the block data once for all related transactions.
	 * @param transactions - A list of objects that must include a block_hash.
	 * @returns A map where each key is a block hash and the value is an array of transactions belonging to that block.
	 */
	private groupTransactionsByBlock<T extends { block_hash: string }>(
		transactions: T[],
	): Map<string, T[]> {
		const txsByBlock = new Map<string, T[]>();
		for (const tx of transactions) {
			const blockHash = tx.block_hash;
			const list = txsByBlock.get(blockHash);
			if (list) {
				list.push(tx);
			} else {
				txsByBlock.set(blockHash, [tx]);
			}
		}
		return txsByBlock;
	}

	// Fetches blocks, verifies Merkle roots, and generates proofs for minting batches.
	private async prepareMintBatches(
		txsByBlock: Map<string, FinalizedTxRow[]>,
	): Promise<PreparedMintBatches> {
		const batches = new Map<
			number,
			{ mintArgs: MintBatchArg[]; processedKeys: ProcessedKey[] }
		>();

		for (const [blockHash, txs] of txsByBlock) {
			try {
				const blockData = await this.fetchAndVerifyBlock(blockHash);
				if (!blockData) {
					logger.warn({
						msg: "Skipping transactions for invalid or missing block",
						blockHash,
						txCount: txs.length,
					});
					continue;
				}
				const { block, merkleTree, calculatedRoot } = blockData;

				for (const txRow of txs) {
					try {
						const txId = txRow.tx_id;
						const transactions = block.transactions;
						const txIndex = transactions?.findIndex((t) => t.getId() === txId) ?? -1;

						if (txIndex < 0 || !transactions) {
							await this.handleMissingFinalizedMintingTx(txId);
							continue;
						}
						const targetTx = transactions[txIndex];
						if (!targetTx) {
							continue;
						}

						const proof = this.getTxProof(merkleTree, targetTx);
						if (!proof) {
							throw new Error("Proof generation failed (returned null or undefined)");
						}

						const setupId = txRow.setup_id;
						const config = this.getPackageConfig(setupId);

						let batch = batches.get(setupId);
						if (!batch) {
							batch = { mintArgs: [], processedKeys: [] };
							batches.set(setupId, batch);
						}

						batch.mintArgs.push({
							tx: targetTx,
							blockHeight: txRow.block_height,
							txIndex: txIndex,
							proof: {
								proofPath: proof,
								merkleRoot: calculatedRoot.toString("hex"),
							},
							nbtcPkg: config.nbtc_pkg,
							suiNetwork: config.sui_network,
							setupId: setupId,
						});
						batch.processedKeys.push({
							tx_id: txRow.tx_id,
							vout: txRow.vout,
						});
					} catch (e) {
						logError(
							{
								msg: "Error preparing mint batch for transaction",
								method: "prepareMintBatches",
								txId: txRow.tx_id,
							},
							e,
						);
					}
				}
			} catch (e) {
				logError(
					{
						msg: "Error preparing mint batch for block",
						method: "prepareMintBatches",
						blockHash,
					},
					e,
				);
			}
		}

		return { batches };
	}

	// Fetches block from storage and verifies its Merkle root.
	private async fetchAndVerifyBlock(
		blockHash: string,
	): Promise<{ block: Block; merkleTree: BitcoinMerkleTree; calculatedRoot: Buffer } | null> {
		const rawBlockBuffer = await this.storage.getBlock(blockHash);
		if (!rawBlockBuffer) {
			logger.warn({
				msg: "Minting: Block data not found in KV",
				blockHash,
			});
			return null;
		}

		const block = Block.fromBuffer(Buffer.from(rawBlockBuffer));
		const merkleTree = this.constructMerkleTree(block);
		if (!merkleTree || !block.transactions) return null;

		// Verify Merkle Root
		const calculatedRoot = merkleTree.getRoot();
		if (block.merkleRoot !== undefined && !block.merkleRoot.equals(calculatedRoot)) {
			logger.error({
				msg: "Failed to generate a valid merkle proof. Root mismatch.",
				blockHash,
				blockRoot: block.merkleRoot?.toString("hex"),
				calculatedRoot: calculatedRoot.toString("hex"),
			});
			return null;
		}

		return { block, merkleTree, calculatedRoot };
	}

	// Marks a transaction as reorged if it is missing from its expected block.
	private async handleMissingFinalizedMintingTx(txId: string): Promise<void> {
		logger.error({
			msg: "Minting: Could not find TX within its block. Detecting reorg.",
			method: "handleMissingFinalizedMintingTx",
			txId,
		});
		try {
			const currentStatus = await this.storage.getTxStatus(txId);
			if (
				currentStatus !== MintTxStatus.Finalized &&
				currentStatus !== MintTxStatus.MintFailed
			) {
				logger.error({
					msg: "Minting: Unexpected status during reorg detection, skipping",
					method: "handleMissingFinalizedMintingTx",
					txId,
					currentStatus,
				});
				return;
			}

			await this.storage.updateNbtcTxsStatus([txId], MintTxStatus.FinalizedReorg);
			logger.warn({
				msg: "Minting: Transaction reorged",
				method: "handleMissingFinalizedMintingTx",
				txId,
				previousStatus: currentStatus,
				newStatus: MintTxStatus.FinalizedReorg,
			});
		} catch (e) {
			logError(
				{
					msg: "Minting: Failed to update reorg status",
					method: "handleMissingFinalizedMintingTx",
					txId,
				},
				e,
			);
			throw e;
		}
	}

	// Submits minting batches to Sui and updates database.
	private async executeMintBatches(batches: PreparedMintBatches["batches"]): Promise<void> {
		if (batches.size === 0) return;

		for (const [setupId, batch] of batches) {
			const { mintArgs, processedKeys } = batch;
			if (mintArgs.length === 0) continue;

			const config = this.getPackageConfig(setupId);
			const client = this.getSuiClient(config.sui_network);
			const pkgKey = config.nbtc_pkg;

			logger.info({
				msg: "Minting: Sending batch of mints to Sui",
				count: mintArgs.length,
				setupId,
				pkgKey,
			});

			const result = await client.tryMintNbtcBatch(mintArgs);
			if (!result) {
				// Pre-submission error (network failure, validation error, etc.)
				logger.error({
					msg: "Sui batch mint transaction failed (pre-submission error)",
					method: "executeMintBatches",
					setupId,
					pkgKey,
				});
				await this.storage.batchUpdateNbtcMintTxs(
					processedKeys.map((p) => ({
						txId: p.tx_id,
						vout: p.vout,
						status: MintTxStatus.MintFailed,
					})),
				);
				continue;
			}

			const [success, suiTxDigest] = result;
			if (success) {
				logger.info({
					msg: "Sui batch mint transaction successful",
					suiTxDigest,
					setupId,
					pkgKey,
				});
				await this.storage.batchUpdateNbtcMintTxs(
					processedKeys.map((p) => ({
						txId: p.tx_id,
						vout: p.vout,
						status: MintTxStatus.Minted,
						suiTxDigest,
					})),
				);
			} else {
				// Transaction executed but failed on-chain
				logger.error({
					msg: "Sui batch mint transaction failed (on-chain failure)",
					method: "executeMintBatches",
					setupId,
					pkgKey,
					suiTxDigest,
				});
				await this.storage.batchUpdateNbtcMintTxs(
					processedKeys.map((p) => ({
						txId: p.tx_id,
						vout: p.vout,
						status: MintTxStatus.MintFailed,
						suiTxDigest,
					})),
				);
			}
		}
	}

	async detectMintedReorgs(blockHeight: number): Promise<void> {
		logger.debug({
			msg: "Checking for reorgs on minted transactions",
			method: "detectMintedReorgs",
			blockHeight,
		});

		const reorgedTxs = await this.storage.getReorgedMintedTxs(blockHeight);
		if (!reorgedTxs || reorgedTxs.length === 0) {
			return;
		}

		const txIds = reorgedTxs.map((tx) => tx.tx_id);
		await this.storage.updateNbtcTxsStatus(txIds, MintTxStatus.MintedReorg);

		logger.error({
			msg: "CRITICAL: Deep reorg detected on minted transactions",
			method: "detectMintedReorgs",
			count: reorgedTxs.length,
			txIds,
			blockHeight,
		});
	}

	constructMerkleTree(block: Block): BitcoinMerkleTree | null {
		if (!block.transactions || block.transactions.length === 0) {
			return null;
		}
		return new BitcoinMerkleTree(block.transactions);
	}

	getTxProof(tree: BitcoinMerkleTree, targetTx: Transaction): Buffer[] | null {
		return tree.getProof(targetTx);
	}

	// Queries the light client to verify that blocks containing
	// 'confirming' txs are still part of the canonical chain.
	// This is used to detect reorgs before proceeding to finalization attempts.
	async verifyConfirmingBlocks(): Promise<void> {
		logger.debug({
			msg: "SPV Check: Verifying 'confirming' blocks with on-chain light client.",
		});

		const blocksToVerify = await this.storage.getConfirmingBlocks();
		if (!blocksToVerify || blocksToVerify.length === 0) {
			logger.debug({ msg: "SPV Check: No confirming blocks to verify." });
			return;
		}

		const distinctNetworks = [...new Set(blocksToVerify.map((b) => b.network))];
		for (const network of distinctNetworks) {
			const config = this.#packageConfigs
				.values()
				.find((c) => c.btc_network === network && c.is_active);
			if (!config) {
				logger.warn({
					msg: "Received Bitcoin block from not configured network, skipping",
					network,
				});
				continue;
			}

			const client = this.getSuiClient(config.sui_network);
			const blockHashes = blocksToVerify
				.filter((r) => r.network === network)
				.map((r) => r.block_hash);

			try {
				const verificationResults = await client.verifyBlocks(blockHashes);
				const invalidHashes: string[] = [];
				for (let i = 0; i < blockHashes.length; i++) {
					if (verificationResults[i] === false) {
						const blockHash = blockHashes[i];
						if (blockHash) {
							invalidHashes.push(blockHash);
						}
					}
				}

				if (invalidHashes.length > 0) {
					await this.storage.updateConfirmingTxsToReorg(invalidHashes);
				} else {
					logger.debug({ msg: "SPV Check: All confirming blocks are valid." });
				}
			} catch (e) {
				logError(
					{
						msg: "Failed to verify blocks with on-chain light client",
						method: "verifyConfirmingBlocks",
						network: network,
					},
					e,
				);
			}
		}
	}

	async updateConfirmationsAndFinalize(): Promise<void> {
		// check the confirming blocks against the SPV.
		await this.verifyConfirmingBlocks();

		await this.processMintingFinalization();
		await this.processRedeemFinalization();
	}

	async processMintingFinalization(): Promise<void> {
		const pendingTxs = await this.storage.getConfirmingTxs();
		if (!pendingTxs || pendingTxs.length === 0) {
			return;
		}
		const networks = new Set(pendingTxs.map((tx) => tx.btc_network));
		const chainHeads = new Map<BtcNet, number>();
		for (const net of networks) {
			const head = await this.storage.getChainTip(net);
			if (head !== null) chainHeads.set(net, head);
		}

		logger.debug({
			msg: "Finalization: Checking 'confirming' transactions",
			count: pendingTxs.length,
			chainHeads: Object.fromEntries(chainHeads),
		});

		const confirmingTxs: ConfirmingTxCandidate<PendingTx>[] = [];
		for (const tx of pendingTxs) {
			if (tx.block_hash !== null) {
				confirmingTxs.push({
					id: tx.tx_id,
					blockHeight: tx.block_height,
					blockHash: tx.block_hash,
					network: tx.btc_network,
					original: tx,
				});
			}
		}

		const { reorged, finalized } = await this.categorizeConfirmingTxs(
			confirmingTxs,
			chainHeads,
		);

		if (reorged.length > 0) {
			const reorgedTxIds = reorged.map((i) => i.id as string);
			logger.debug({
				msg: "Finalization: Updating reorged transactions",
				count: reorgedTxIds.length,
			});
			await this.storage.updateNbtcTxsStatus(reorgedTxIds, MintTxStatus.Reorg);
		}

		const validFinalizedTxs = finalized.map((i) => i.original);
		const { activeTxIds, inactiveTxIds } = this.splitActiveInactiveTxs(validFinalizedTxs);

		if (activeTxIds.length > 0) {
			logger.debug({
				msg: "Finalization: Updating active transactions in D1",
				method: "Indexer.processMintingFinalization",
				count: activeTxIds.length,
			});
			await this.storage.finalizeNbtcTxs(activeTxIds);
		}
		if (inactiveTxIds.length > 0) {
			logger.debug({
				msg: "Finalization: Updating inactive transactions in D1",
				method: "Indexer.processMintingFinalization",
				count: inactiveTxIds.length,
			});
			await this.storage.updateNbtcTxsStatus(inactiveTxIds, MintTxStatus.FinalizedNonActive);
		}
	}

	async processRedeemFinalization(): Promise<void> {
		const btcNetworks = new Set<BtcNet>();
		for (const cfg of this.#packageConfigs.values()) {
			btcNetworks.add(cfg.btc_network);
		}

		const tasks = Array.from(btcNetworks).map((net) =>
			this.processRedeemFinalizationForNetwork(net).catch((e) => {
				logError(
					{
						msg: "Error processing redeem finalization for network",
						method: "processRedeemFinalization",
						network: net,
					},
					e,
				);
			}),
		);
		await Promise.all(tasks);
	}

	private async processRedeemFinalizationForNetwork(net: BtcNet): Promise<void> {
		const chainHead = await this.storage.getChainTip(net);
		if (chainHead === null) return;

		const confirmingRedeems = await this.suiIndexer.getConfirmingRedeems(net);
		if (confirmingRedeems.length === 0) return;

		logger.debug({
			msg: "Checking confirmations for redeems",
			network: net,
			count: confirmingRedeems.length,
			chainHead,
		});

		const chainHeads = new Map<BtcNet, number>([[net, chainHead]]);

		const confirmingTxs: ConfirmingTxCandidate<ConfirmingRedeemReq>[] = confirmingRedeems.map(
			(r) => ({
				id: r.redeem_id,
				blockHeight: r.btc_block_height,
				blockHash: r.btc_block_hash,
				network: btcNetFromString(r.btc_network),
				original: r,
			}),
		);

		const { reorged, finalized } = await this.categorizeConfirmingTxs(
			confirmingTxs,
			chainHeads,
		);

		await this.handleRedeemReorgs(reorged);
		await this.handleRedeemFinalization(finalized);
	}

	private async handleRedeemReorgs(
		reorged: ConfirmingTxCandidate<ConfirmingRedeemReq>[],
	): Promise<void> {
		if (reorged.length === 0) return;

		const redeemIds: number[] = [];
		for (const tx of reorged) {
			logger.debug({
				msg: "Redeem Reorg detected (block hash mismatch)",
				redeemId: tx.original.redeem_id,
				oldHash: tx.original.btc_block_hash,
			});
			redeemIds.push(tx.original.redeem_id);
		}

		await this.suiIndexer.updateRedeemStatuses(redeemIds, RedeemRequestStatus.Reorg);
	}

	private async handleRedeemFinalization(
		finalized: ConfirmingTxCandidate<ConfirmingRedeemReq>[],
	): Promise<void> {
		const finalizedByBlock = this.groupTransactionsByBlock(
			finalized.map((f) => ({ ...f.original, block_hash: f.blockHash })),
		);

		for (const [blockHash, redeems] of finalizedByBlock) {
			await this.processFinalizedRedeemBlock(blockHash, redeems);
		}
	}

	private async processFinalizedRedeemBlock(
		blockHash: string,
		redeems: ConfirmingRedeemReq[],
	): Promise<void> {
		const blockData = await this.fetchAndVerifyBlock(blockHash);
		if (!blockData) {
			logger.warn({
				msg: "Redeem finalization: block not found in storage",
				hash: blockHash,
				count: redeems.length,
			});
			return;
		}

		const { block, merkleTree } = blockData;
		const batch: FinalizeRedeemTx[] = [];

		for (const r of redeems) {
			const txIndex = block.transactions?.findIndex((t) => t.getId() === r.btc_tx) ?? -1;

			if (txIndex === -1 || !block.transactions) {
				// Data integrity error: Tx verified in DB but missing from the actual block data.
				logger.error({
					msg: "Redeem finalization: Tx not found in block",
					redeemId: r.redeem_id,
					txId: r.btc_tx,
					blockHash: r.btc_block_hash,
				});
				continue;
			}

			const targetTx = block.transactions[txIndex];
			if (!targetTx) continue;

			const proof = this.getTxProof(merkleTree, targetTx);
			if (!proof) {
				// Safety check: failed to generate proof for a transaction verified to be in the block.
				logger.error({
					msg: "Redeem finalization: Failed to generate proof",
					redeemId: r.redeem_id,
				});
				continue;
			}

			const proofHex = proof.map((p) => p.toString("hex"));
			batch.push({
				redeemId: r.redeem_id,
				proof: proofHex,
				height: r.btc_block_height,
				txIndex,
			});
		}

		if (batch.length > 0) {
			logger.debug({
				msg: "Redeem Finalization: sending batch to Sui Indexer",
				count: batch.length,
			});
			await this.suiIndexer.finalizeRedeems(batch);
		}
	}

	// breaks down transactions past the "finality confirmations" into confirmed and reorged.
	private async categorizeConfirmingTxs<T>(
		txs: ConfirmingTxCandidate<T>[],
		chainHeads: Map<BtcNet, number>, // number is the latest block height (chain tip)
	): Promise<{ reorged: ConfirmingTxCandidate<T>[]; finalized: ConfirmingTxCandidate<T>[] }> {
		const reorged: ConfirmingTxCandidate<T>[] = [];
		const finalized: ConfirmingTxCandidate<T>[] = [];

		for (const tx of txs) {
			const tip = chainHeads.get(tx.network);
			if (tip === undefined) continue;

			const currentHash = await this.storage.getBlockHash(tx.blockHeight, tx.network);
			if (!currentHash) {
				logger.warn({
					msg: "Skipping finalization check: Block hash not found in storage",
					height: tx.blockHeight,
					network: tx.network,
					txId: tx.id,
				});
				continue;
			}

			if (currentHash !== tx.blockHash) {
				reorged.push(tx);
				continue;
			}

			const confs = calculateConfirmations(tx.blockHeight, tip);
			if (confs >= this.confirmationDepth) {
				finalized.push(tx);
			}
		}
		return { reorged, finalized };
	}

	splitActiveInactiveTxs(pendingTxs: PendingTx[]): {
		activeTxIds: string[];
		inactiveTxIds: string[];
	} {
		const activeTxIds: string[] = [];
		const inactiveTxIds: string[] = [];
		for (const tx of pendingTxs) {
			const depositInfo = this.nbtcDepositAddrMap.get(tx.deposit_address);
			let isPkgActive = false;
			if (depositInfo) {
				const setup = this.getPackageConfig(depositInfo.setup_id);
				if (setup && setup.is_active && depositInfo.is_active) {
					isPkgActive = true;
				}
			}

			if (isPkgActive) {
				logger.info({
					msg: "Transaction finalized (Active Key)",
					txId: tx.tx_id,
					depositAddress: tx.deposit_address,
				});
				activeTxIds.push(tx.tx_id);
			} else {
				logger.info({
					msg: "Transaction finalized (Inactive Key) - Minting will be skipped",
					txId: tx.tx_id,
					depositAddress: tx.deposit_address,
				});
				inactiveTxIds.push(tx.tx_id);
			}
		}
		return { activeTxIds, inactiveTxIds };
	}

	// queries NbtcTxResp by BTC Tx ID
	async getNbtcMintTx(txid: string): Promise<NbtcTxResp | null> {
		const nbtMintRow = await this.storage.getNbtcMintTx(txid);
		if (!nbtMintRow) return null;

		const latestHeight = await this.storage.getChainTip(nbtMintRow.btc_network);

		return nbtcRowToResp(nbtMintRow, latestHeight);
	}

	async getNbtcMintTxsBySuiAddr(suiAddress: string): Promise<NbtcTxResp[]> {
		const dbResult = await this.storage.getNbtcMintTxsBySuiAddr(suiAddress);

		const networks = new Set(dbResult.map((tx) => tx.btc_network));
		const chainTips = new Map<string, number | null>();
		for (const net of networks) {
			chainTips.set(net, await this.storage.getChainTip(net));
		}

		return dbResult.map((tx): NbtcTxResp => {
			const latestHeight = chainTips.get(tx.btc_network) ?? null;
			return nbtcRowToResp(tx, latestHeight);
		});
	}

	async registerBroadcastedNbtcTx(txHex: string, network: BtcNet): Promise<PutNbtcTxResponse> {
		const tx = Transaction.fromHex(txHex);
		const txId = tx.getId();
		const btcNetwork = btcNetworkCfg[network];
		if (!btcNetwork) {
			throw new Error(`Unknown network: ${network}`);
		}
		const deposits = this.findNbtcDeposits(tx, btcNetwork);
		if (deposits.length === 0) {
			throw new Error("Transaction does not contain any valid nBTC deposits.");
		}

		if (await this.hasNbtcMintTx(txId)) {
			logger.debug({
				msg: "Transaction already exists, skipping registration",
				method: "Indexer.registerBroadcastedNbtcTx",
				txId,
			});
			return { tx_id: txId, registered_deposits: 0 };
		}

		const txSenders = await this.getSenderAddresses(tx, network);
		const sender = txSenders[0] || "";

		const depositData = deposits.map((d) => ({ ...d, txId, btcNetwork: network, sender }));
		await this.storage.registerBroadcastedNbtcTx(depositData);
		logger.info({
			msg: "New nBTC minting deposit TX registered",
			txId,
			registeredCount: deposits.length,
		});
		return { tx_id: txId, registered_deposits: deposits.length };
	}

	async broadcastRedeemTx(
		txHex: string,
		network: BtcNet,
		redeemId: number,
	): Promise<{ tx_id: string }> {
		const electrs = this.getElectrsClient(network);
		const response = await electrs.broadcastTx(txHex);

		if (!response.ok) {
			const error = await response.text();
			logError(
				{
					msg: "Failed to broadcast redeem transaction",
					method: "broadcastRedeemTx",
					redeemId,
					network,
				},
				new Error(error),
			);
			throw new Error(`Broadcast failed: ${error}`);
		}

		const txId = await response.text();
		logger.info({
			msg: "Redeem transaction broadcasted",
			redeemId,
			txId,
			network,
		});

		return { tx_id: txId };
	}

	async getLatestHeight(network: BtcNet): Promise<{ height: number | null }> {
		const height = await this.storage.getLatestBlockHeight(network);
		return { height };
	}

	async getDepositsBySender(btcAddress: string, network: BtcNet): Promise<NbtcTxResp[]> {
		const nbtcMintRows = await this.storage.getNbtcMintTxsByBtcSender(btcAddress, network);

		const latestHeight = await this.storage.getChainTip(network);

		return nbtcMintRows.map((r) => nbtcRowToResp(r, latestHeight));
	}

	private async getSenderAddresses(tx: Transaction, network: BtcNet): Promise<string[]> {
		const senderAddresses = new Set<string>();
		const electrs = this.getElectrsClient(network);
		const prevTxFetches = tx.ins.map(async (input) => {
			const prevTxId = Buffer.from(input.hash).reverse().toString("hex");
			const prevTxVout = input.index;
			try {
				const response = await electrs.getTx(prevTxId);
				if (!response.ok) return;
				const prevTx = (await response.json()) as ElectrsTxResponse;
				const prevOutput = prevTx.vout[prevTxVout];
				if (prevOutput?.scriptpubkey_address) {
					senderAddresses.add(prevOutput.scriptpubkey_address);
				}
			} catch (e) {
				logError(
					{
						msg: "Failed to fetch previous tx for sender address via service binding",
						method: "getSenderAddresses",
						prevTxId,
					},
					e,
				);
			}
		});
		await Promise.all(prevTxFetches);
		return Array.from(senderAddresses);
	}
}

export function parseSuiRecipientFromOpReturn(script: Buffer): string | null {
	if (script.length === 0 || script[0] !== OP_RETURN) {
		return null;
	}
	if (script.length < 2) {
		return null;
	}
	const payload = script.subarray(2);

	// Check simple transfer format: 1-byte flag (0x00)
	if (payload[0] === 0x00) {
		const addressBytes = payload.subarray(1);
		const address = `0x${addressBytes.toString("hex")}`;
		if (!isValidSuiAddress(address)) {
			return null;
		}
		return address;
	}
	//TODO: in the future we need to update the relayer to correctly handle the flag 0x01
	// for now we cannot determine the recipient
	return null;
}

function nbtcRowToResp(r: NbtcTxRow, latestHeight: number | null): NbtcTxResp {
	const confirmations = calculateConfirmations(r.block_height, latestHeight);
	const btcTxId = r.tx_id;
	// @ts-expect-error The operand of a 'delete' operator must be optional
	delete r.tx_id;

	return {
		btcTxId,
		confirmations,
		...r,
	};
}
