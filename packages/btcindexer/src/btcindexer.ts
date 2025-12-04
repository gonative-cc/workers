import { address, networks, Block, Transaction, type Network } from "bitcoinjs-lib";
import {
	BtcNet,
	btcNetFromString,
	requireElectrsUrl,
	type BlockQueueRecord,
} from "@gonative-cc/lib/nbtc";

import { OP_RETURN } from "./opcodes";
import { BitcoinMerkleTree } from "./bitcoin-merkle-tree";
import { SuiClient, type SuiClientI } from "./sui_client";
import type {
	Deposit,
	PendingTx,
	NbtcTxResp,
	MintBatchArg,
	GroupedFinalizedTx,
	NbtcTxRow,
	NbtcTxInsertion,
	ElectrsTxResponse,
	NbtcPkgCfg,
	NbtcDepositAddrsMap,
} from "./models";
import { MintTxStatus } from "./models";
import { logError, logger } from "@gonative-cc/lib/logger";
import type { Electrs } from "./electrs";
import { ElectrsService } from "./electrs";
import { fetchNbtcAddresses, fetchPackageConfigs, type Storage } from "./storage";
import { CFStorage } from "./cf-storage";
import type { PutNbtcTxResponse } from "./rpc-interface";
import type { SuiNet } from "@gonative-cc/lib/nsui";

const btcNetworkCfg: Record<BtcNet, Network> = {
	[BtcNet.MAINNET]: networks.bitcoin,
	[BtcNet.TESTNET]: networks.testnet,
	[BtcNet.REGTEST]: networks.regtest,
	[BtcNet.SIGNET]: networks.testnet,
};

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

	const mnemonic = await env.NBTC_MINTING_SIGNER_MNEMONIC.get();
	const suiClients = new Map();
	for (const p of packageConfigs) {
		if (!suiClients.has(p.sui_network))
			suiClients.set(p.sui_network, new SuiClient(p, mnemonic));
	}

	try {
		return new Indexer(
			storage,
			packageConfigs,
			suiClients,
			nbtcDepositAddrMap,
			confirmationDepth,
			maxNbtcMintTxRetries,
			// TODO: we need to support multiple networks
			new ElectrsService(requireElectrsUrl(btcNetFromString(env.BITCOIN_NETWORK))),
		);
	} catch (err) {
		logError({ msg: "Can't create initialize btcindexer", method: "Indexer.constructor" }, err);
		throw err;
	}
}

export class Indexer {
	storage: Storage;
	electrs: Electrs;
	confirmationDepth: number;
	maxNbtcMintTxRetries: number;
	nbtcDepositAddrMap: NbtcDepositAddrsMap;
	// TODO: change to DB pkg id (number)
	#packageConfigs: Map<string, NbtcPkgCfg>; // Sui nbtc module Pkg -> pkg config
	#suiClients: Map<SuiNet, SuiClientI>;

	constructor(
		storage: Storage,
		packageConfigs: NbtcPkgCfg[],
		suiClients: Map<SuiNet, SuiClientI>,
		nbtcDepositAddrMap: NbtcDepositAddrsMap,
		confirmationDepth: number,
		maxRetries: number,
		electrs: Electrs,
	) {
		if (packageConfigs.length === 0) {
			throw new Error("No active nBTC packages configured.");
		}
		if (nbtcDepositAddrMap.size === 0) {
			throw new Error("No nBTC deposit addresses configured.");
		}
		for (const p of packageConfigs) {
			if (!suiClients.has(p.sui_network))
				throw new Error("No nBTC deposit addresses configured.");
		}
		// TODO: const pkgCfgMap = new Map(packageConfigs.map((c) => [c.id, c]));
		const pkgCfgMap = new Map(packageConfigs.map((c) => [c.nbtc_pkg, c]));
		for (const n of nbtcDepositAddrMap) {
			if (!pkgCfgMap.has(n[1].package_id))
				throw new Error("No nBTC config found for bitcoin addresses " + n[0]);
		}

		this.storage = storage;
		this.nbtcDepositAddrMap = nbtcDepositAddrMap;
		this.confirmationDepth = confirmationDepth;
		this.maxNbtcMintTxRetries = maxRetries;
		this.electrs = electrs;
		this.#packageConfigs = pkgCfgMap;
		this.#suiClients = suiClients;
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

	// Query NbtcPkgCfg by db table row ID.
	getPackageConfig(nbtcPkgId: number): NbtcPkgCfg {
		const c = this.#packageConfigs.get(nbtcPkgId);
		if (c === undefined) throw new Error("No Nbtc pkg for pkg_id = " + nbtcPkgId);
		return c;
	}

	// - extracts and processes nBTC deposit transactions in the block
	// - handles reorgs
	async processBlock(blockInfo: BlockQueueRecord): Promise<void> {
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
		const existingHash = await this.storage.getBlockHash(blockInfo.height, blockInfo.network);

		const isNewOrMinted = await this.storage.insertBlockInfo(blockInfo);
		if (!isNewOrMinted) {
			logger.debug({
				msg: "Skipping processing already processed block",
				method: "Indexer.processBlock",
				height: blockInfo.height,
				hash: blockInfo.hash,
			});
			return;
		}

		if (existingHash !== null && existingHash !== blockInfo.hash) {
			logger.info({
				msg: "Reorg detected, calling detectMintedReorgs",
				height: blockInfo.height,
				existingHash,
				newHash: blockInfo.hash,
			});
			await this.detectMintedReorgs(blockInfo.height);
		}

		const nbtcTxs: NbtcTxInsertion[] = [];
		for (const tx of block.transactions ?? []) {
			const deposits = this.findNbtcDeposits(tx, network);
			if (deposits.length > 0) {
				// TODO: getSenderAddresses must take network
				const txSenders = await this.getSenderAddresses(tx);
				const sender = txSenders[0] || ""; // Use first sender or empty string if none found
				if (txSenders.length > 1) {
					logger.warn({
						msg: "Multiple senders found for tx, using first one",
						txId: tx.getId(),
						senders: txSenders,
					});
				}

				for (const deposit of deposits) {
					logger.info({
						msg: "Found new nBTC deposit",
						txId: tx.getId(),
						vout: deposit.vout,
						amountSats: deposit.amountSats,
						suiRecipient: deposit.suiRecipient,
						nbtcPkg: deposit.nbtcPkg,
						suiNetwork: deposit.suiNetwork,
						depositAddress: deposit.depositAddress,
						sender,
					});

					nbtcTxs.push({
						txId: tx.getId(),
						vout: deposit.vout,
						blockHash: blockInfo.hash,
						blockHeight: blockInfo.height,
						suiRecipient: deposit.suiRecipient,
						amountSats: deposit.amountSats,
						btcNetwork: blockInfo.network,
						nbtcPkg: deposit.nbtcPkg,
						suiNetwork: deposit.suiNetwork,
						depositAddress: deposit.depositAddress,
						sender,
					});
				}
			}
		}

		if (nbtcTxs.length > 0) {
			await this.storage.insertOrUpdateNbtcTxs(nbtcTxs);
		}

		if (nbtcTxs.length === 0) {
			logger.debug({ msg: "No new nBTC deposits found in block" });
		}

		await this.storage.markBlockAsProcessed(blockInfo.hash, blockInfo.network);
		await this.storage.setChainTip(blockInfo.height);
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
				const pkgId = this.nbtcDepositAddrMap.get(btcAddress)?.package_id;
				if (pkgId === undefined) continue;
				const config = this.getPackageConfig(pkgId);

				logger.debug({
					msg: "Found matching nBTC deposit output",
					txId: tx.getId(),
					vout: i,
				});
				let finalRecipient = suiRecipient;
				if (!finalRecipient) {
					finalRecipient = config.sui_fallback_address;
				}

				deposits.push({
					vout: i,
					amountSats: Number(vout.value),
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

	async processFinalizedTransactions(): Promise<void> {
		const finalizedTxs = await this.storage.getNbtcMintCandidates(this.maxNbtcMintTxRetries);

		if (!finalizedTxs || finalizedTxs.length === 0) {
			return;
		}
		logger.info({
			msg: "Minting: Found deposits to process",
			count: finalizedTxs.length,
		});

		// Group all finalized deposits by their parent transaction ID.
		// A single Bitcoin transaction can contain multiple outputs (vouts) that pay to the nBTC
		// deposit address. While the transaction typically has only one OP_RETURN to specify the
		// Sui recipient, that single recipient applies to *all* deposit outputs within that transaction.
		// Our indexer stores each of these deposits as a separate row.
		// For the on-chain minting process, however all deposits from a single transaction must be
		// processed together because they share a single Merkle proof. This grouping step
		// collects all related deposits to generate a single proof. These groups are then further
		// batched by their destination nBTC package for the final minting calls.
		//
		// TODO: Consider refactoring the database schema to store one row per transaction, rather than
		// per deposit output. The schema could have columns like `vouts` (a list of vout indexes),
		// `total_amount`, and `op_return_data`. This would align the database structure more
		// closely with the on-chain reality and could simplify this function by removing the
		// need for this grouping step.
		const groupedTxs = new Map<string, GroupedFinalizedTx>();
		for (const row of finalizedTxs) {
			const group = groupedTxs.get(row.tx_id);
			if (group) {
				group.deposits.push(row);
			} else {
				groupedTxs.set(row.tx_id, {
					blockHash: row.block_hash,
					blockHeight: row.block_height,
					deposits: [row],
				});
			}
		}

		const mintBatchArgsByPkg = new Map<string, MintBatchArg[]>();
		const processedKeysByPkg = new Map<string, { tx_id: string; vout: number }[]>();

		for (const [txId, txGroup] of groupedTxs.entries()) {
			try {
				const rawBlockBuffer = await this.storage.getBlock(txGroup.blockHash);
				if (!rawBlockBuffer) {
					logger.warn({
						msg: "Minting: Block data not found in KV, skipping transaction.",
						txId,
						blockHash: txGroup.blockHash,
					});
					continue;
				}
				const block = Block.fromBuffer(Buffer.from(rawBlockBuffer));
				const merkleTree = this.constructMerkleTree(block);
				if (!merkleTree) continue;

				if (!block.transactions) {
					continue;
				}

				const txIndex = block.transactions.findIndex((tx) => tx.getId() === txId);

				if (txIndex === -1) {
					logger.error({
						msg: "Minting: Could not find TX within its block. Detecting reorg.",
						method: "processFinalizedTransactions",
						txId,
					});
					try {
						// We are processing a finalized transaction for minting, but discovered it is not in its
						// block anymore (reorg detected). We verify the status is still Finalized or MintFailed
						// before marking it as FinalizedReorg.
						const currentStatus = await this.storage.getTxStatus(txId);
						if (
							currentStatus !== MintTxStatus.Finalized &&
							currentStatus !== MintTxStatus.MintFailed
						) {
							logger.error({
								msg: "Minting: Unexpected status during reorg detection, skipping",
								method: "processFinalizedTransactions",
								txId,
								currentStatus,
							});
							continue;
						}

						await this.storage.updateNbtcTxsStatus([txId], MintTxStatus.FinalizedReorg);
						logger.warn({
							msg: "Minting: Transaction reorged",
							method: "processFinalizedTransactions",
							txId,
							previousStatus: currentStatus,
							newStatus: MintTxStatus.FinalizedReorg,
						});
					} catch (e) {
						logError(
							{
								msg: "Minting: Failed to update reorg status",
								method: "processFinalizedTransactions",
								txId,
							},
							e,
						);
						throw e;
					}
					continue;
				}

				const targetTx = block.transactions[txIndex];
				if (!targetTx) continue;

				const proof = this.getTxProof(merkleTree, targetTx);

				// NOTE: Soundness check. A mismatch between our calculated
				// Merkle root and the one in the block header should  never happen.
				// If it does, it indicates that the merkle tree implementaiton is incorrect,
				// corrupted block data in KV, or a faulty realyer (sending us wrong data).
				const calculatedRoot = merkleTree.getRoot();
				if (
					!proof ||
					(block.merkleRoot !== undefined && !block.merkleRoot.equals(calculatedRoot))
				) {
					logger.error({
						msg: "Failed to generate a valid merkle proof. Root mismatch.",
						txId,
						blockRoot: block.merkleRoot?.toString("hex"),
						calculatedRoot: calculatedRoot.toString("hex"),
					});
					continue;
				}

				const firstDeposit = txGroup.deposits[0];
				if (!firstDeposit) {
					logger.warn({
						msg: "Minting: Skipping transaction group with no deposits",
						method: "processFinalizedTransactions",
						txId,
					});
					continue;
				}
				const nbtcPkg = firstDeposit.nbtc_pkg;
				const suiNetwork = firstDeposit.sui_network;
				const pkgKey = nbtcPkg;

				if (!nbtcPkg || !suiNetwork) {
					logger.warn({
						msg: "Minting: Skipping transaction group with missing nbtc_pkg or sui_network, likely old data.",
						txId,
					});
					continue;
				}

				if (!mintBatchArgsByPkg.has(pkgKey)) {
					mintBatchArgsByPkg.set(pkgKey, []);
					processedKeysByPkg.set(pkgKey, []);
				}

				const mintBatchArgs = mintBatchArgsByPkg.get(pkgKey);
				if (mintBatchArgs) {
					mintBatchArgs.push({
						tx: targetTx,
						blockHeight: txGroup.blockHeight,
						txIndex: txIndex,
						proof: { proofPath: proof, merkleRoot: calculatedRoot.toString("hex") },
						nbtcPkg: nbtcPkg,
						suiNetwork: suiNetwork,
					});
				}

				for (const deposit of txGroup.deposits) {
					const processedKeys = processedKeysByPkg.get(pkgKey);
					if (processedKeys) {
						processedKeys.push({
							tx_id: deposit.tx_id,
							vout: deposit.vout,
						});
					}
				}
			} catch (e) {
				logError(
					{
						msg: "Error preparing transaction for minting batch, will retry",
						method: "processFinalizedTransactions",
						txId,
					},
					e,
				);
				// NOTE: We don't update the status here. The transaction will be picked up
				// again in the next run of processFinalizedTransactions.
			}
		}

		if (mintBatchArgsByPkg.size > 0) {
			for (const [pkgKey, mintBatchArgs] of mintBatchArgsByPkg.entries()) {
				const processedPrimaryKeys = processedKeysByPkg.get(pkgKey);
				if (!processedPrimaryKeys || processedPrimaryKeys.length === 0) {
					continue;
				}

				const firstBatchArg = mintBatchArgs[0];
				if (!firstBatchArg) {
					continue;
				}
				// TODO: use nbtc db row id
				const config = this.getPackageConfig(firstBatchArg.nbtcPkg);
				const client = this.getSuiClient(config.sui_network);

				logger.info({
					msg: "Minting: Sending batch of mints to Sui",
					count: mintBatchArgs.length,
					pkgKey: pkgKey,
				});

				const suiTxDigest = await client.tryMintNbtcBatch(mintBatchArgs);
				if (suiTxDigest) {
					logger.info({
						msg: "Sui batch mint transaction successful",
						suiTxDigest,
						pkgKey,
					});
					await this.storage.batchUpdateNbtcTxs(
						processedPrimaryKeys.map((p) => ({
							txId: p.tx_id,
							vout: p.vout,
							status: MintTxStatus.Minted,
							suiTxDigest,
						})),
					);
				} else {
					logger.error({
						msg: "Sui batch mint transaction failed",
						method: "processFinalizedTransactions",
						pkgKey,
					});
					await this.storage.batchUpdateNbtcTxs(
						processedPrimaryKeys.map((p) => ({
							txId: p.tx_id,
							vout: p.vout,
							status: MintTxStatus.MintFailed,
						})),
					);
				}
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
		try {
			return tree.getProof(targetTx);
		} catch (e) {
			logError(
				{ msg: "Failed to get merkle proof", method: "getTxProof", txId: targetTx.getId() },
				e,
			);
			return null;
		}
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
			const config = Array.from(this.#packageConfigs.values()).find(
				(c) => c.btc_network === network && c.is_active,
			);
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
					logger.warn({
						msg: "SPV Check: Detected reorged blocks. Updating transaction statuses.",
						reorgedBlockHashes: invalidHashes,
					});
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

	async updateConfirmationsAndFinalize(latestHeight: number): Promise<void> {
		// check the confirming blocks against the SPV.
		await this.verifyConfirmingBlocks();

		const pendingTxs = await this.storage.getConfirmingTxs();
		if (!pendingTxs || pendingTxs.length === 0) {
			return;
		}
		logger.debug({
			msg: "Finalization: Checking 'confirming' transactions",
			count: pendingTxs.length,
			chainTipHeight: latestHeight,
		});

		const { reorgedTxIds } = await this.handleReorgs(pendingTxs);
		if (reorgedTxIds.length > 0) {
			logger.debug({
				msg: "Finalization: Updating reorged transactions",
				count: reorgedTxIds.length,
			});
			// This requires a new method in the Storage interface like:
			// updateTxsStatus(txIds: string[], status: TxStatus): Promise<void>
			await this.storage.updateNbtcTxsStatus(reorgedTxIds, MintTxStatus.Reorg);
		}

		// TODO: add a unit test for it so we make sure we do not finalize reorrged tx.
		const validPendingTxs = pendingTxs.filter((tx) => !reorgedTxIds.includes(tx.tx_id));
		const { activeTxIds, inactiveTxIds } = this.selectFinalizedNbtcTxs(
			validPendingTxs,
			latestHeight,
		);

		if (activeTxIds.length > 0) {
			logger.debug({
				msg: "Finalization: Updating active transactions in D1",
				method: "Indexer.updateConfirmationsAndFinalize",
				count: activeTxIds.length,
			});
			await this.storage.finalizeNbtcTxs(activeTxIds);
		}
		if (inactiveTxIds.length > 0) {
			logger.debug({
				msg: "Finalization: Updating inactive transactions in D1",
				method: "Indexer.updateConfirmationsAndFinalize",
				count: inactiveTxIds.length,
			});
			await this.storage.updateNbtcTxsStatus(inactiveTxIds, MintTxStatus.FinalizedNonActive);
		}
	}

	async handleReorgs(pendingTxs: PendingTx[]): Promise<{ reorgedTxIds: string[] }> {
		const reorgedTxIds: string[] = [];
		for (const tx of pendingTxs) {
			if (tx.block_hash === null) continue;
			const hash = await this.storage.getBlockHash(tx.block_height, tx.btc_network);
			if (hash) {
				if (hash !== tx.block_hash) {
					logger.warn({
						msg: "Reorg detected",
						txId: tx.tx_id,
						height: tx.block_height,
						oldHash: tx.block_hash,
						newHash: hash,
					});
					reorgedTxIds.push(tx.tx_id);
				}
			}
		}
		return { reorgedTxIds };
	}

	selectFinalizedNbtcTxs(
		pendingTxs: PendingTx[],
		latestHeight: number,
	): { activeTxIds: string[]; inactiveTxIds: string[] } {
		const activeTxIds: string[] = [];
		const inactiveTxIds: string[] = [];
		for (const tx of pendingTxs) {
			const confirmations = latestHeight - tx.block_height + 1;
			if (confirmations >= this.confirmationDepth) {
				// check if the bitcoin deposit address is defined and active
				const isActive =
					tx.deposit_address ??
					this.nbtcDepositAddrMap.get(tx.deposit_address)?.is_active;
				if (isActive) {
					logger.info({
						msg: "Transaction finalized (Active Key)",
						txId: tx.tx_id,
						confirmations,
						required: this.confirmationDepth,
						depositAddress: tx.deposit_address,
					});
					activeTxIds.push(tx.tx_id);
				} else {
					logger.info({
						msg: "Transaction finalized (Inactive Key) - Minting will be skipped",
						txId: tx.tx_id,
						confirmations,
						required: this.confirmationDepth,
						depositAddress: tx.deposit_address,
					});
					inactiveTxIds.push(tx.tx_id);
				}
			}
		}
		return { activeTxIds, inactiveTxIds };
	}

	// queries NbtcTxResp by BTC Tx ID
	async getNbtcMintTx(txid: string): Promise<NbtcTxResp | null> {
		const nbtMintRow = await this.storage.getNbtcMintTx(txid);
		if (!nbtMintRow) return null;

		const latestHeight = await this.storage.getChainTip();

		return nbtcRowToResp(nbtMintRow, latestHeight);
	}

	async getNbtcMintTxsBySuiAddr(suiAddress: string): Promise<NbtcTxResp[]> {
		const latestHeight = await this.storage.getChainTip();
		const dbResult = await this.storage.getNbtcMintTxsBySuiAddr(suiAddress);

		return dbResult.map((tx): NbtcTxResp => {
			const blockHeight = tx.block_height as number;
			const confirmations = blockHeight && latestHeight ? latestHeight - blockHeight + 1 : 0;
			return {
				...tx,
				btcTxId: tx.tx_id,
				status: tx.status as MintTxStatus,
				block_height: blockHeight,
				confirmations: confirmations > 0 ? confirmations : 0,
			};
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

		const txSenders = await this.getSenderAddresses(tx);
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

	async getLatestHeight(): Promise<{ height: number | null }> {
		const height = await this.storage.getLatestBlockHeight();
		return { height };
	}

	async getDepositsBySender(btcAddress: string): Promise<NbtcTxResp[]> {
		const nbtcMintRows = await this.storage.getNbtcMintTxsByBtcSender(btcAddress);
		const latestHeight = await this.storage.getChainTip();

		return nbtcMintRows.map((r) => nbtcRowToResp(r, latestHeight));
	}

	private async getSenderAddresses(tx: Transaction): Promise<string[]> {
		const senderAddresses = new Set<string>();
		const prevTxFetches = tx.ins.map(async (input) => {
			const prevTxId = Buffer.from(input.hash).reverse().toString("hex");
			const prevTxVout = input.index;
			try {
				const response = await this.electrs.getTx(prevTxId);
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

function parseSuiRecipientFromOpReturn(script: Buffer): string | null {
	if (script.length === 0 || script[0] !== OP_RETURN) {
		return null;
	}
	if (script.length < 2) {
		return null;
	}
	const payload = script.subarray(2);

	// Check simple transfer format: 1-byte flag (0x00)
	// TODO: add validation for the sui address
	if (payload[0] === 0x00) {
		const addressBytes = payload.subarray(1);
		return `0x${addressBytes.toString("hex")}`;
	}
	//TODO: in the future we need to update the relayer to correctly handle the flag 0x01
	// for now we cannot determine the recipient
	return null;
}

function nbtcRowToResp(r: NbtcTxRow, latestHeight: number | null): NbtcTxResp {
	const bh = r.block_height;
	const confirmations = bh && latestHeight ? latestHeight - bh + 1 : 0;
	const btcTxId = r.tx_id;
	// @ts-expect-error The operand of a 'delete' operator must be optional
	delete r.tx_id;

	return {
		btcTxId,
		confirmations: confirmations > 0 ? confirmations : 0,
		...r,
	};
}
