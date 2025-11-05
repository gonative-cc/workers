import { PutBlocks } from "./api/put-blocks";
import { address, networks, Block, Transaction } from "bitcoinjs-lib";
import { OP_RETURN } from "./opcodes";
import { BitcoinMerkleTree } from "./bitcoin-merkle-tree";
import SuiClient, { suiClientFromEnv } from "./sui_client";
import {
	Deposit,
	PendingTx,
	TxStatus,
	TxStatusResp as TxStatusResp,
	MintBatchArg,
	GroupedFinalizedTx,
	BlockStatus,
} from "./models";
import { toSerializableError } from "./errutils";
import { Electrs, ElectrsService } from "./electrs";
import { Storage } from "./storage";
import { CFStorage } from "./cf-storage";

const btcNetworks = {
	mainnet: networks.bitcoin,
	testnet: networks.testnet,
	regtest: networks.regtest,
};
const validBtcNet = Object.keys(btcNetworks).keys();

export async function indexerFromEnv(env: Env): Promise<Indexer> {
	const storage = new CFStorage(env.DB, env.btc_blocks, env.nbtc_txs);
	const sc = await suiClientFromEnv(env);

	if (!env.BITCOIN_NETWORK) throw Error("BITCOIN_NETWORK env must be set");
	if (!(env.BITCOIN_NETWORK in btcNetworks))
		throw new Error("Invalid BITCOIN_NETWORK value. Must be in " + validBtcNet);
	const btcNet = btcNetworks[env.BITCOIN_NETWORK];

	const confirmationDepth = parseInt(env.CONFIRMATION_DEPTH || "8", 10);
	if (isNaN(confirmationDepth) || confirmationDepth < 1) {
		throw new Error("Invalid CONFIRMATION_DEPTH in config. Must be a number greater than 0.");
	}

	const maxNbtcMintTxRetries = parseInt(env.MAX_NBTC_MINT_TX_RETRIES || "1", 10);
	if (isNaN(maxNbtcMintTxRetries) || maxNbtcMintTxRetries < 0) {
		throw new Error("Invalid MAX_NBTC_MINT_TX_RETRIES in config. Must be a number >= 0.");
	}

	const btcBlockProcessingBatchSize = parseInt(env.BTC_BLOCK_PROCESSING_BATCH_SIZE || "10", 10);
	if (isNaN(btcBlockProcessingBatchSize) || btcBlockProcessingBatchSize < 1) {
		throw new Error("Invalid BTC_BLOCK_PROCESSING_BATCH_SIZE in config. Must be a number > 0.");
	}

	return new Indexer(
		storage,
		sc,
		env.NBTC_DEPOSIT_ADDRESS,
		env.SUI_FALLBACK_ADDRESS,
		btcNet,
		confirmationDepth,
		maxNbtcMintTxRetries,
		btcBlockProcessingBatchSize,
		new ElectrsService(env.ELECTRS_API_URL),
	);
}

export class Indexer {
	storage: Storage;
	electrs: Electrs;
	nbtcScriptHex: string;
	suiFallbackAddr: string;
	nbtcClient: SuiClient;
	confirmationDepth: number;
	maxNbtcMintTxRetries: number;
	btcBlockProcessingBatchSize: number;

	constructor(
		storage: Storage,
		suiClient: SuiClient,
		nbtcAddr: string,
		fallbackAddr: string,
		network: networks.Network,
		confirmationDepth: number,
		maxRetries: number,
		scanBatchSize: number,
		electrs: Electrs,
	) {
		this.storage = storage;
		this.nbtcClient = suiClient;
		this.suiFallbackAddr = fallbackAddr;
		this.nbtcScriptHex = address.toOutputScript(nbtcAddr, network).toString("hex");
		this.confirmationDepth = confirmationDepth;
		this.maxNbtcMintTxRetries = maxRetries;
		this.btcBlockProcessingBatchSize = scanBatchSize;
		this.electrs = electrs;
	}

	// returns number of processed and add blocks
	async putBlocks(blocks: PutBlocks[]): Promise<number> {
		if (!blocks || blocks.length === 0) {
			return 0;
		}
		await this.storage.putBlocks(blocks);
		return blocks.length;
	}

	// returns true if tx has not been processed yet, false if it was already inserted
	async putNbtcTx(): Promise<boolean> {
		// TODO
		// 1. check if tx is nBTC segwit payment
		// 2. check if not duplicated
		// 3. insert in D1
		// 4. insert in nbtcTxDB
		//    this.saveNbtcTx(tx)

		return true;
	}

	async scanNewBlocks(): Promise<void> {
		console.debug({ msg: "Cron: Running scanNewBlocks job" });
		const blocksToProcess = await this.storage.getBlocksToProcess(
			this.btcBlockProcessingBatchSize,
		);

		if (!blocksToProcess || blocksToProcess.length === 0) {
			console.debug({ msg: "Cron: No new blocks to scan" });
			return;
		}

		console.debug({
			msg: "Cron: Found blocks to process",
			count: blocksToProcess.length,
		});

		const nbtcTxs: {
			txId: string;
			vout: number;
			blockHash: string;
			blockHeight: number;
			suiRecipient: string;
			amountSats: number;
		}[] = [];
		let senders: { txId: string; sender: string }[] = [];

		for (const blockInfo of blocksToProcess) {
			console.log({
				msg: "Cron: processing block",
				height: blockInfo.height,
				hash: blockInfo.hash,
			});
			const rawBlockBuffer = await this.storage.getBlock(blockInfo.hash);
			if (!rawBlockBuffer) {
				console.warn({
					msg: "Cron: Block data not found in KV, skipping scan for this block",
					blockHash: blockInfo.hash,
					blockHeight: blockInfo.height,
				});
				continue;
			}
			const block = Block.fromBuffer(Buffer.from(rawBlockBuffer));

			for (const tx of block.transactions ?? []) {
				const deposits = this.findNbtcDeposits(tx);
				if (deposits.length > 0) {
					const newSenders = await this.getSenderAddresses(tx);
					senders = senders.concat(
						newSenders.map((s) => ({ txId: tx.getId(), sender: s })),
					);
				}
				for (const deposit of deposits) {
					console.log({
						msg: "Cron: Found new nBTC deposit",
						txId: tx.getId(),
						vout: deposit.vout,
						amountSats: deposit.amountSats,
						suiRecipient: deposit.suiRecipient,
					});
					nbtcTxs.push({
						txId: tx.getId(),
						vout: deposit.vout,
						blockHash: blockInfo.hash,
						blockHeight: blockInfo.height,
						suiRecipient: deposit.suiRecipient,
						amountSats: deposit.amountSats,
					});
				}
			}
		}

		if (nbtcTxs.length > 0) {
			await this.storage.insertOrUpdateNbtcTxs(nbtcTxs);
		}
		if (senders.length > 0) {
			await this.storage.insertSenderDeposits(senders);
		}

		if (nbtcTxs.length === 0) {
			console.debug({ msg: "Cron: No new nBTC deposits found in scanned blocks" });
		}

		const latestHeightProcessed = Math.max(...blocksToProcess.map((b) => b.height));
		await this.storage.setChainTip(latestHeightProcessed);
		console.log({ msg: "Cron: Updated chain_tip", latestHeight: latestHeightProcessed });

		const heightsToUpdate = blocksToProcess.map((r) => r.height);
		if (heightsToUpdate.length > 0) {
			await this.storage.updateBlockStatus(heightsToUpdate, BlockStatus.SCANNED);
		}
	}

	findNbtcDeposits(tx: Transaction): Deposit[] {
		const deposits: Deposit[] = [];
		let suiRecipient: string | null = null;

		for (const vout of tx.outs) {
			const parsedRecipient = parseSuiRecipientFromOpReturn(vout.script);
			if (parsedRecipient) {
				suiRecipient = parsedRecipient;
				console.debug({
					msg: "Parsed Sui recipient from OP_RETURN",
					txId: tx.getId(),
					suiRecipient,
				});
				break; // valid tx should have only one OP_RETURN
			}
		}

		if (!suiRecipient) suiRecipient = this.suiFallbackAddr;

		for (let i = 0; i < tx.outs.length; i++) {
			const vout = tx.outs[i];
			if (vout.script.toString("hex") === this.nbtcScriptHex) {
				console.debug({
					msg: "Found matching nBTC deposit output",
					txId: tx.getId(),
					vout: i,
				});
				deposits.push({
					vout: i,
					amountSats: Number(vout.value),
					suiRecipient,
				});
			}
		}
		return deposits;
	}

	async processFinalizedTransactions(): Promise<void> {
		const finalizedTxs = await this.storage.getFinalizedTxs(this.maxNbtcMintTxRetries);

		if (!finalizedTxs || finalizedTxs.length === 0) {
			return;
		}
		console.log({
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
		// collects all related deposits so we can generate one proof and make one batch mint call.
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
					block_hash: row.block_hash,
					block_height: row.block_height,
					deposits: [row],
				});
			}
		}

		const mintBatchArgs: MintBatchArg[] = [];
		const processedPrimaryKeys: { tx_id: string; vout: number; success: boolean }[] = [];

		for (const [txId, txGroup] of groupedTxs.entries()) {
			try {
				const rawBlockBuffer = await this.storage.getBlock(txGroup.block_hash);
				if (!rawBlockBuffer) {
					console.warn({
						msg: "Minting: Block data not found in KV, skipping transaction.",
						txId,
						blockHash: txGroup.block_hash,
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
					console.error({
						msg: "Minting: Could not find TX within its block. Setting status to 'finalized-reorg'.",
						txId,
					});
					try {
						await this.storage.updateTxsStatus([txId], TxStatus.FINALIZED_REORG);
					} catch (e) {
						console.error({
							msg: "Minting: Failed to update status to 'finalized-reorg'",
							error: toSerializableError(e),
							txId,
						});
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
					console.error({
						msg: "Failed to generate a valid merkle proof. Root mismatch.",
						txId,
						blockRoot: block.merkleRoot?.toString("hex"),
						calculatedRoot: calculatedRoot.toString("hex"),
					});
					continue;
				}

				mintBatchArgs.push({
					tx: targetTx,
					blockHeight: txGroup.block_height,
					txIndex: txIndex,
					proof: { proofPath: proof, merkleRoot: calculatedRoot.toString("hex") },
				});
				for (const deposit of txGroup.deposits) {
					processedPrimaryKeys.push({
						tx_id: deposit.tx_id,
						vout: deposit.vout,
						success: true,
					});
				}
			} catch (e) {
				console.error({
					msg: "Minting: Error preparing transaction for minting batch",
					error: toSerializableError(e),
					txId,
				});
				for (const deposit of txGroup.deposits) {
					processedPrimaryKeys.push({
						tx_id: deposit.tx_id,
						vout: deposit.vout,
						success: false,
					});
				}
			}
		}

		if (mintBatchArgs.length > 0) {
			console.log({
				msg: "Minting: Sending batch of mints to Sui",
				count: mintBatchArgs.length,
			});
			const suiTxDigest = await this.nbtcClient.tryMintNbtcBatch(mintBatchArgs);
			if (suiTxDigest) {
				console.log({ msg: "Sui batch mint transaction successful", suiTxDigest });
				await this.storage.batchUpdateNbtcTxs(
					processedPrimaryKeys.map((p) => ({
						...p,
						status: TxStatus.MINTED,
						suiTxDigest,
					})),
				);
			} else {
				console.error({ msg: "Sui batch mint transaction failed", suiTxDigest });
				await this.storage.batchUpdateNbtcTxs(
					processedPrimaryKeys.map((p) => ({
						...p,
						status: TxStatus.FINALIZED_FAILED,
						suiTxDigest: suiTxDigest ?? undefined,
					})),
				);
			}
		}
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
			console.error({
				msg: "Failed to get merkle proof",
				error: toSerializableError(e),
				txId: targetTx.getId(),
			});
			return null;
		}
	}

	// Queries the light client to verify that blocks containing
	// 'confirming' txs are still part of the canonical chain.
	// This is used to detect reorgs before proceeding to finalization attempts.
	async verifyConfirmingBlocks(): Promise<void> {
		console.debug({
			msg: "SPV Check: Verifying 'confirming' blocks with on-chain light client.",
		});

		const blocksToVerify = await this.storage.getConfirmingBlocks();

		if (!blocksToVerify || blocksToVerify.length === 0) {
			console.debug({ msg: "SPV Check: No confirming blocks to verify." });
			return;
		}

		const blockHashes = blocksToVerify.map((r) => r.block_hash);

		try {
			const verificationResults = await this.nbtcClient.verifyBlocks(blockHashes);

			const invalidHashes: string[] = [];
			for (let i = 0; i < blockHashes.length; i++) {
				if (verificationResults[i] === false) {
					invalidHashes.push(blockHashes[i]);
				}
			}

			if (invalidHashes.length > 0) {
				console.warn({
					msg: "SPV Check: Detected reorged blocks. Updating transaction statuses.",
					reorgedBlockHashes: invalidHashes,
				});
				await this.storage.updateConfirmingTxsToReorg(invalidHashes);
			} else {
				console.debug({ msg: "SPV Check: All confirming blocks are valid." });
			}
		} catch (e) {
			console.error({
				msg: "SPV Check: Failed to verify blocks with on-chain light client.",
				error: toSerializableError(e),
			});
		}
	}

	async updateConfirmationsAndFinalize(latestHeight: number): Promise<void> {
		// check the confirming blocks against the SPV.
		await this.verifyConfirmingBlocks();

		const pendingTxs = await this.storage.getConfirmingTxs();

		if (!pendingTxs || pendingTxs.length === 0) {
			return;
		}
		console.debug({
			msg: "Finalization: Checking 'confirming' transactions",
			count: pendingTxs.length,
			chainTipHeight: latestHeight,
		});

		const { reorgedTxIds } = await this.handleReorgs(pendingTxs);
		if (reorgedTxIds.length > 0) {
			console.debug({
				msg: "Finalization: Updating reorged transactions",
				count: reorgedTxIds.length,
			});
			// This requires a new method in the Storage interface like:
			// updateTxsStatus(txIds: string[], status: TxStatus): Promise<void>
			await this.storage.updateTxsStatus(reorgedTxIds, TxStatus.REORG);
		}

		// TODO: add a unit test for it so we make sure we do not finalize reorrged tx.
		const validPendingTxs = pendingTxs.filter((tx) => !reorgedTxIds.includes(tx.tx_id));
		const finalizationTxIds = this.selectFinalizedNbtcTxs(validPendingTxs, latestHeight);

		if (finalizationTxIds.length > 0) {
			console.debug({
				msg: "Finalization: Applying status updates to D1",
				finalizedCount: finalizationTxIds.length,
			});
			await this.storage.finalizeTxs(finalizationTxIds);
		}
	}

	async handleReorgs(pendingTxs: PendingTx[]): Promise<{ reorgedTxIds: string[] }> {
		const reorgedTxIds: string[] = [];

		for (const tx of pendingTxs) {
			if (tx.block_hash === null) continue;
			const newBlockInQueue = await this.storage.getBlockInfo(tx.block_height);

			if (newBlockInQueue) {
				if (newBlockInQueue.hash !== tx.block_hash) {
					console.warn({
						msg: "Reorg detected",
						txId: tx.tx_id,
						height: tx.block_height,
						oldHash: tx.block_hash,
						newHash: newBlockInQueue.hash,
					});
					reorgedTxIds.push(tx.tx_id);
				}
			}
		}
		return { reorgedTxIds };
	}

	selectFinalizedNbtcTxs(pendingTxs: PendingTx[], latestHeight: number): string[] {
		const txIds: string[] = [];
		for (const tx of pendingTxs) {
			const confirmations = latestHeight - tx.block_height + 1;
			if (confirmations >= this.confirmationDepth) {
				console.log({
					msg: "Transaction has enough confirmations, finalizing.",
					txId: tx.tx_id,
					confirmations,
					required: this.confirmationDepth,
				});
				txIds.push(tx.tx_id);
			}
		}
		return txIds;
	}

	async getStatusByTxid(txid: string): Promise<TxStatusResp | null> {
		const latestHeight = await this.storage.getChainTip();
		const tx = await this.storage.getStatusByTxid(txid);

		if (!tx) {
			return null;
		}

		const blockHeight = tx.block_height as number;
		const confirmations = blockHeight && latestHeight ? latestHeight - blockHeight + 1 : 0;

		return {
			...tx,
			btc_tx_id: tx.tx_id,
			status: tx.status as TxStatus,
			block_height: blockHeight,
			confirmations: confirmations > 0 ? confirmations : 0,
		};
	}

	async getStatusBySuiAddress(suiAddress: string): Promise<TxStatusResp[]> {
		const latestHeight = await this.storage.getChainTip();
		const dbResult = await this.storage.getStatusBySuiAddress(suiAddress);

		return dbResult.map((tx): TxStatusResp => {
			const blockHeight = tx.block_height as number;
			const confirmations = blockHeight && latestHeight ? latestHeight - blockHeight + 1 : 0;
			return {
				...tx,
				btc_tx_id: tx.tx_id,
				status: tx.status as TxStatus,
				block_height: blockHeight,
				confirmations: confirmations > 0 ? confirmations : 0,
			};
		});
	}

	async registerBroadcastedNbtcTx(
		txHex: string,
	): Promise<{ tx_id: string; registered_deposits: number }> {
		const tx = Transaction.fromHex(txHex);
		const txId = tx.getId();

		const deposits = this.findNbtcDeposits(tx);
		if (deposits.length === 0) {
			throw new Error("Transaction does not contain any valid nBTC deposits.");
		}

		const depositData = deposits.map((d) => ({ ...d, txId }));
		await this.storage.registerBroadcastedNbtcTx(depositData);

		console.log({
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

	async getDepositsBySender(btcAddress: string): Promise<TxStatusResp[]> {
		const dbResult = await this.storage.getDepositsBySender(btcAddress);
		const latestHeight = await this.storage.getChainTip();

		return dbResult.map((tx): TxStatusResp => {
			const blockHeight = tx.block_height as number;
			const confirmations = blockHeight && latestHeight ? latestHeight - blockHeight + 1 : 0;

			return {
				btc_tx_id: tx.tx_id,
				status: tx.status as TxStatus,
				sui_tx_id: tx.sui_tx_id,
				block_height: blockHeight,
				confirmations: confirmations > 0 ? confirmations : 0,
				sui_recipient: tx.sui_recipient,
				amount_sats: tx.amount_sats,
			};
		});
	}

	private async getSenderAddresses(tx: Transaction): Promise<string[]> {
		const senderAddresses = new Set<string>();
		const prevTxFetches = tx.ins.map(async (input) => {
			const prevTxId = Buffer.from(input.hash).reverse().toString("hex");
			const prevTxVout = input.index;

			try {
				const response = await this.electrs.getTx(prevTxId);
				if (!response.ok) return;

				const prevTx = (await response.json()) as {
					vout: { scriptpubkey_address?: string }[];
				};
				const prevOutput = prevTx.vout[prevTxVout];
				if (prevOutput?.scriptpubkey_address) {
					senderAddresses.add(prevOutput.scriptpubkey_address);
				}
			} catch (e) {
				console.error({
					msg: "Failed to fetch previous tx for sender address via service binding",
					error: toSerializableError(e),
					prevTxId,
				});
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
