import { address, networks, Block, Transaction, type Network } from "bitcoinjs-lib";
import { BtcNet, type BlockQueueRecord } from "@gonative-cc/lib/nbtc";

import { OP_RETURN } from "./opcodes";
import { BitcoinMerkleTree } from "./bitcoin-merkle-tree";
import { SuiClient, type SuiClientI } from "./sui_client";
import type {
	Deposit,
	PendingTx,
	NbtcTxResp,
	MintBatchArg,
	NbtcTxRow,
	NbtcTxInsertion,
	ElectrsTxResponse,
	NbtcPkgCfg,
	NbtcDepositAddrsMap,
	FinalizedTxRow,
} from "./models";
import { MintTxStatus } from "./models";
import { logError, logger } from "@gonative-cc/lib/logger";
import type { Electrs } from "./electrs";
import { ElectrsService, ELECTRS_URLS_BY_NETWORK } from "./electrs";
import { fetchNbtcAddresses, fetchPackageConfigs, type Storage } from "./storage";
import { CFStorage } from "./cf-storage";
import type { PutNbtcTxResponse } from "./rpc-interface";
import type { SuiNet } from "@gonative-cc/lib/nsui";

interface MintTask {
	arg: MintBatchArg;
	txId: string;
	vout: number;
}

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

	constructor(
		storage: Storage,
		packageConfigs: NbtcPkgCfg[],
		suiClients: Map<SuiNet, SuiClientI>,
		nbtcDepositAddrMap: NbtcDepositAddrsMap,
		confirmationDepth: number,
		maxRetries: number,
		electrsClients: Map<BtcNet, Electrs>,
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
			if (!pkgCfgMap.has(n[1].package_id))
				throw new Error("No nBTC package config found for bitcoin address " + n[0]);
		}

		this.storage = storage;
		this.nbtcDepositAddrMap = nbtcDepositAddrMap;
		this.confirmationDepth = confirmationDepth;
		this.maxNbtcMintTxRetries = maxRetries;
		this.#electrsClients = electrsClients;
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
				const txSenders = await this.getSenderAddresses(tx, blockInfo.network);
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
		const mintCandidates = await this.storage.getNbtcMintCandidates(this.maxNbtcMintTxRetries);

		if (!mintCandidates || mintCandidates.length === 0) {
			return;
		}
		logger.info({
			msg: "Minting: Found deposits to process",
			count: mintCandidates.length,
		});

		// Map: PackageID -> Array of MintTask
		const batches = new Map<string, MintTask[]>();

		for (const row of mintCandidates) {
			const mintData = await this.prepareMintData(row);
			if (mintData) {
				const pkgId = mintData.arg.nbtcPkg;
				if (!batches.has(pkgId)) {
					batches.set(pkgId, []);
				}
				batches.get(pkgId)?.push(mintData);
			}
		}

		for (const [pkgId, mintTasks] of batches) {
			if (!mintTasks || mintTasks.length === 0) continue;

			const result = await this.executeMintBatch(pkgId, mintTasks);
			if (!result) {
				// Pre-submission error (Network/RPC failure)
				logger.error({
					msg: "Sui batch mint transaction failed (pre-submission error)",
					method: "processFinalizedTransactions",
					pkgId,
				});
				await this.updateMintBatchStatus(mintTasks, MintTxStatus.MintFailed);
				continue;
			}

			const [success, suiTxDigest] = result;

			if (success) {
				// Success
				logger.info({
					msg: "Sui batch mint transaction successful",
					suiTxDigest,
					pkgId,
				});
				await this.updateMintBatchStatus(mintTasks, MintTxStatus.Minted, suiTxDigest);
			} else {
				// On-chain Failure (Move abort, etc.)
				logger.error({
					msg: "Sui batch mint transaction failed (on-chain failure)",
					method: "processFinalizedTransactions",
					pkgId,
					suiTxDigest,
				});
				await this.updateMintBatchStatus(mintTasks, MintTxStatus.MintFailed, suiTxDigest);
			}
		}
	}

	private async updateMintBatchStatus(
		tasks: MintTask[],
		status: MintTxStatus,
		digest?: string,
	): Promise<void> {
		await this.storage.batchUpdateNbtcTxs(
			tasks.map((t) => ({
				txId: t.txId,
				vout: t.vout,
				status: status,
				suiTxDigest: digest,
			})),
		);
	}

	private async prepareMintData(row: FinalizedTxRow): Promise<MintTask | null> {
		const txId = row.tx_id;
		try {
			const rawBlockBuffer = await this.storage.getBlock(row.block_hash);
			if (!rawBlockBuffer) {
				logger.warn({
					msg: "Minting: Block data not found in KV, skipping transaction.",
					txId,
					blockHash: row.block_hash,
				});
				return null;
			}
			const block = Block.fromBuffer(Buffer.from(rawBlockBuffer));
			const merkleTree = this.constructMerkleTree(block);
			if (!merkleTree) return null;

			if (!block.transactions) {
				return null;
			}

			const txIndex = block.transactions.findIndex((tx) => tx.getId() === txId);

			if (txIndex === -1) {
				logger.error({
					msg: "Minting: Could not find TX within its block. Detecting reorg.",
					method: "processFinalizedTransactions",
					txId,
				});
				await this.handleMintReorg(txId);
				return null;
			}

			const targetTx = block.transactions[txIndex];
			if (!targetTx) return null;

			const proof = this.getTxProof(merkleTree, targetTx);

			// NOTE: Soundness check.
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
				return null;
			}

			return {
				arg: {
					tx: targetTx,
					blockHeight: row.block_height,
					txIndex: txIndex,
					proof: { proofPath: proof, merkleRoot: calculatedRoot.toString("hex") },
					nbtcPkg: row.nbtc_pkg,
					suiNetwork: row.sui_network,
					packageId: row.package_id,
				},
				txId: row.tx_id,
				vout: row.vout,
			};
		} catch (e) {
			logError(
				{
					msg: "Error preparing transaction for minting batch, will retry",
					method: "prepareMintData",
					txId,
				},
				e,
			);
			return null;
		}
	}

	private async handleMintReorg(txId: string): Promise<void> {
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
					method: "handleMintReorg",
					txId,
					currentStatus,
				});
				return;
			}

			await this.storage.updateNbtcTxsStatus([txId], MintTxStatus.FinalizedReorg);
			logger.warn({
				msg: "Minting: Transaction reorged",
				method: "handleMintReorg",
				txId,
				previousStatus: currentStatus,
				newStatus: MintTxStatus.FinalizedReorg,
			});
		} catch (e) {
			logError(
				{
					msg: "Minting: Failed to update reorg status",
					method: "handleMintReorg",
					txId,
				},
				e,
			);
			throw e;
		}
	}

	private async executeMintBatch(
		pkgKey: string,
		tasks: MintTask[],
	): Promise<[boolean, string] | null> {
		if (!tasks || tasks.length === 0) {
			return null;
		}

		const firstTask = tasks[0];
		if (!firstTask) return null;

		const config = this.getPackageConfig(firstTask.arg.packageId);
		const client = this.getSuiClient(config.sui_network);

		logger.info({
			msg: "Minting: Sending batch of mints to Sui",
			count: tasks.length,
			pkgKey: pkgKey,
		});

		const mintArgs = tasks.map((j) => j.arg);
		return await client.tryMintNbtcBatch(mintArgs);
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
				const depositInfo = this.nbtcDepositAddrMap.get(tx.deposit_address);
				let isPkgActive = false;
				if (depositInfo) {
					const pkgConfig = this.getPackageConfig(depositInfo.package_id);
					if (pkgConfig && pkgConfig.is_active && depositInfo.is_active) {
						isPkgActive = true;
					}
				}

				if (isPkgActive) {
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

	async getLatestHeight(): Promise<{ height: number | null }> {
		const height = await this.storage.getLatestBlockHeight();
		return { height };
	}

	async getDepositsBySender(btcAddress: string): Promise<NbtcTxResp[]> {
		const nbtcMintRows = await this.storage.getNbtcMintTxsByBtcSender(btcAddress);
		const latestHeight = await this.storage.getChainTip();

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
