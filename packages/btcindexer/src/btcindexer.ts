import { PutBlocks } from "./api/put-blocks";
import { address, networks, Block, Transaction } from "bitcoinjs-lib";
import { OP_RETURN } from "./opcodes";
import { BitcoinMerkleTree } from "./bitcoin-merkle-tree";
import SuiClient, { suiClientFromEnv } from "./sui_client";
import {
	Deposit,
	PendingTx,
	Storage,
	NbtcTxStatus,
	NbtcTxStatusResp,
	NbtcTxRow,
	MintBatchArg,
	FinalizedTxRow,
	GroupedFinalizedTx,
} from "./models";
import { toSerializableError } from "./errutils";

export function storageFromEnv(env: Env): Storage {
	return { d1: env.DB, blocksDB: env.btc_blocks, nbtcTxDB: env.nbtc_txs };
}

const btcNetworks = {
	mainnet: networks.bitcoin,
	testnet: networks.testnet,
	regtest: networks.regtest,
};
const validBtcNet = Object.keys(btcNetworks).keys();

export async function indexerFromEnv(env: Env): Promise<Indexer> {
	const storage = storageFromEnv(env);
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
	);
}

export class Indexer implements Storage {
	d1: D1Database; // SQL DB
	blocksDB: KVNamespace;
	nbtcTxDB: KVNamespace;

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
	) {
		this.d1 = storage.d1;
		this.blocksDB = storage.blocksDB;
		this.nbtcTxDB = storage.nbtcTxDB;
		this.nbtcClient = suiClient;
		this.suiFallbackAddr = fallbackAddr;
		this.nbtcScriptHex = address.toOutputScript(nbtcAddr, network).toString("hex");
		this.confirmationDepth = confirmationDepth;
		this.maxNbtcMintTxRetries = maxRetries;
		this.btcBlockProcessingBatchSize = scanBatchSize;
	}

	// returns number of processed and add blocks
	async putBlocks(blocks: PutBlocks[]): Promise<number> {
		if (!blocks || blocks.length === 0) {
			return 0;
		}

		const blockHeights = blocks.map((b) => b.height);
		console.log({
			msg: "Ingesting blocks",
			count: blocks.length,
			heights: blockHeights,
		});

		const now = Date.now();
		const insertBlockStmt = this.d1.prepare(
			`INSERT INTO btc_blocks (height, hash, status, processed_at) VALUES (?, ?, 'new', ?)
			 ON CONFLICT(height)
			  DO UPDATE SET
			   hash = excluded.hash,
			   processed_at = excluded.processed_at
			 WHERE btc_blocks.hash IS NOT excluded.hash`,
		);

		// TODO: store in KV
		const putKVs = blocks.map((b) => this.blocksDB.put(b.block.getId(), b.block.toBuffer()));
		const putD1s = blocks.map((b) => insertBlockStmt.bind(b.height, b.block.getId(), now));

		try {
			await Promise.all([...putKVs, this.d1.batch(putD1s)]);
		} catch (e) {
			console.error({
				msg: "Failed to store one or more blocks in KV or D1",
				error: toSerializableError(e),
				blockHeights,
			});
			// TODO: decide what to do in the case where some blocks were saved and some not, prolly we need more granular error
			throw new Error(`Could not save all blocks data`);
		}
		console.log({ msg: "Successfully ingested blocks", count: blocks.length });
		return blocks.length;
	}

	async saveNbtcTx(tx: Transaction) {
		return this.nbtcTxDB.put(tx.getId(), tx.toBuffer());
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
		const blocksToProcess = await this.d1
			.prepare(
				"SELECT height, hash FROM btc_blocks WHERE status = 'new' ORDER BY height ASC LIMIT ?",
			)
			.bind(this.btcBlockProcessingBatchSize)
			.all<{ height: number; hash: string }>();

		if (!blocksToProcess.results || blocksToProcess.results.length === 0) {
			console.debug({ msg: "Cron: No new blocks to scan" });
			return;
		}

		console.debug({
			msg: "Cron: Found blocks to process",
			count: blocksToProcess.results.length,
		});

		const nbtcTxStatements: D1PreparedStatement[] = [];

		const now = Date.now();
		const insertOrUpdateNbtcTxStmt = this.d1.prepare(
			`INSERT INTO nbtc_minting (tx_id, vout, block_hash, block_height, sui_recipient, amount_sats, status, created_at, updated_at)
         	VALUES (?, ?, ?, ?, ?, ?, 'confirming', ?, ?)
         	ON CONFLICT(tx_id, vout) DO UPDATE SET
				block_hash = excluded.block_hash,
				block_height = excluded.block_height,
				status = 'confirming',
				updated_at = excluded.updated_at`,
		);

		for (const blockInfo of blocksToProcess.results) {
			console.log({
				msg: "Cron: processing block",
				height: blockInfo.height,
				hash: blockInfo.hash,
			});
			const rawBlockBuffer = await this.blocksDB.get(blockInfo.hash, {
				type: "arrayBuffer",
			});
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
				for (const deposit of deposits) {
					console.log({
						msg: "Cron: Found new nBTC deposit",
						txId: tx.getId(),
						vout: deposit.vout,
						amountSats: deposit.amountSats,
						suiRecipient: deposit.suiRecipient,
					});
					nbtcTxStatements.push(
						insertOrUpdateNbtcTxStmt.bind(
							tx.getId(),
							deposit.vout,
							blockInfo.hash,
							blockInfo.height,
							deposit.suiRecipient,
							deposit.amountSats,
							now,
							now,
						),
					);
				}
			}
		}

		if (nbtcTxStatements.length > 0) {
			try {
				await this.d1.batch(nbtcTxStatements);
			} catch (e) {
				console.error({
					msg: "Cron: Failed to insert nBTC transactions",
					error: toSerializableError(e),
				});
				throw e;
			}
		} else {
			console.debug({ msg: "Cron: No new nBTC deposits found in scanned blocks" });
		}

		const latestHeightProcessed = Math.max(...blocksToProcess.results.map((b) => b.height));
		await this.blocksDB.put("chain_tip", latestHeightProcessed.toString());
		console.log({ msg: "Cron: Updated chain_tip", latestHeight: latestHeightProcessed });

		const heightsToUpdate = blocksToProcess.results.map((r) => r.height);
		if (heightsToUpdate.length > 0) {
			const placeholders = heightsToUpdate.map(() => "?").join(",");
			const updateStmt = `UPDATE btc_blocks SET status = 'scanned' WHERE height IN (${placeholders})`;
			try {
				await this.d1
					.prepare(updateStmt)
					.bind(...heightsToUpdate)
					.run();
				console.debug({
					msg: "Cron: Marked blocks as scanned",
					count: heightsToUpdate.length,
				});
			} catch (e) {
				console.error({
					msg: "Cron: Failed to mark blocks as scanned",
					error: toSerializableError(e),
				});
				throw e;
			}
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
		const finalizedTxs = await this.d1
			.prepare(
				"SELECT tx_id, vout, block_hash, block_height, retry_count FROM nbtc_minting WHERE status = 'finalized' OR (status = 'failed' AND retry_count <= ?)",
			)
			.bind(this.maxNbtcMintTxRetries)
			.all<FinalizedTxRow>();

		if (!finalizedTxs.results || finalizedTxs.results.length === 0) {
			return;
		}
		console.log({
			msg: "Minting: Found deposits to process",
			count: finalizedTxs.results.length,
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
		for (const row of finalizedTxs.results) {
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
				const rawBlockBuffer = await this.blocksDB.get(txGroup.block_hash, {
					type: "arrayBuffer",
				});
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
					// TODO: we should add a `dangling` status for those txs
					console.error({
						msg: "Minting: Could not find TX within its block, skipping.",
						txId,
					});
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
			const now = Date.now();
			if (suiTxDigest) {
				console.log({ msg: "Sui batch mint transaction successful", suiTxDigest });
				const setMintedStmt = this.d1.prepare(
					`UPDATE nbtc_minting SET status = 'minted', sui_tx_id = ?, updated_at = ? WHERE tx_id = ? AND vout = ?`,
				);
				const updates = processedPrimaryKeys.map((p) =>
					setMintedStmt.bind(suiTxDigest, now, p.tx_id, p.vout),
				);
				try {
					await this.d1.batch(updates);
				} catch (e) {
					console.error({
						msg: "Minting: Failed to update status to 'minted'",
						error: toSerializableError(e),
					});
					throw e;
				}
			} else {
				console.error({ msg: "Sui batch mint transaction failed" });
				const setFailedStmt = this.d1.prepare(
					`UPDATE nbtc_minting SET status = 'failed', retry_count = retry_count + 1, updated_at = ? WHERE tx_id = ? AND vout = ?`,
				);
				const updates = processedPrimaryKeys.map((p) =>
					setFailedStmt.bind(now, p.tx_id, p.vout),
				);
				try {
					await this.d1.batch(updates);
				} catch (e) {
					console.error({
						msg: "Minting: Failed to update status to 'failed'",
						error: toSerializableError(e),
					});
					throw e;
				}
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

	async updateConfirmationsAndFinalize(latestHeight: number): Promise<void> {
		const pendingTxs = await this.d1
			.prepare(
				"SELECT tx_id, block_hash, block_height FROM nbtc_minting WHERE status = 'confirming'",
			)
			.all<{ tx_id: string; block_hash: string; block_height: number }>();

		if (!pendingTxs.results || pendingTxs.results.length === 0) {
			return;
		}
		console.debug({
			msg: "Finalization: Checking 'confirming' transactions",
			count: pendingTxs.results.length,
			chainTipHeight: latestHeight,
		});

		const { reorgUpdates, reorgedTxIds } = await this.handleReorgs(pendingTxs.results);
		// TODO: add a unit test for it so we make sure we do not finalize reorrged tx.
		const validPendingTxs = pendingTxs.results.filter((tx) => !reorgedTxIds.includes(tx.tx_id));
		const finalizationUpdates = this.selectFinalizedNbtcTxs(validPendingTxs, latestHeight);
		const allUpdates = [...reorgUpdates, ...finalizationUpdates];

		if (allUpdates.length > 0) {
			console.debug({
				msg: "Finalization: Applying status updates to D1",
				reorgCount: reorgUpdates.length,
				finalizedCount: finalizationUpdates.length,
			});
			try {
				await this.d1.batch(allUpdates);
			} catch (e) {
				console.error({
					msg: "Failed to apply finalization batch updates to D1.",
					error: toSerializableError(e),
				});
				throw e;
			}
		}
	}

	async handleReorgs(
		pendingTxs: PendingTx[],
	): Promise<{ reorgUpdates: D1PreparedStatement[]; reorgedTxIds: string[] }> {
		const reorgUpdates: D1PreparedStatement[] = [];
		const reorgedTxIds: string[] = [];
		const now = Date.now();
		const reorgCheckStmt = this.d1.prepare("SELECT hash FROM btc_blocks WHERE height = ?");
		const reorgStmt = this.d1.prepare(
			`UPDATE nbtc_minting SET status = 'reorg', updated_at = ${now} WHERE tx_id = ?`,
		);

		for (const tx of pendingTxs) {
			const newBlockInQueue = await reorgCheckStmt
				.bind(tx.block_height)
				.first<{ hash: string }>();

			if (newBlockInQueue) {
				if (newBlockInQueue.hash !== tx.block_hash) {
					console.warn({
						msg: "Reorg detected",
						txId: tx.tx_id,
						height: tx.block_height,
						oldHash: tx.block_hash,
						newHash: newBlockInQueue.hash,
					});
					reorgUpdates.push(reorgStmt.bind(tx.tx_id));
					reorgedTxIds.push(tx.tx_id);
				}
			}
		}
		return { reorgUpdates, reorgedTxIds };
	}

	selectFinalizedNbtcTxs(pendingTxs: PendingTx[], latestHeight: number): D1PreparedStatement[] {
		const updates: D1PreparedStatement[] = [];
		const now = Date.now();
		const finalizeStmt = this.d1.prepare(
			`UPDATE nbtc_minting SET status = 'finalized', updated_at = ${now} WHERE tx_id = ?`,
		);

		for (const tx of pendingTxs) {
			const confirmations = latestHeight - tx.block_height + 1;
			if (confirmations >= this.confirmationDepth) {
				console.log({
					msg: "Transaction has enough confirmations, finalizing.",
					txId: tx.tx_id,
					confirmations,
					required: this.confirmationDepth,
				});
				updates.push(finalizeStmt.bind(tx.tx_id));
			}
		}
		return updates;
	}

	async getStatusByTxid(txid: string): Promise<NbtcTxStatusResp | null> {
		const latestHeightStr = await this.blocksDB.get("chain_tip");
		const latestHeight = latestHeightStr ? parseInt(latestHeightStr, 10) : 0;

		const tx = await this.d1
			.prepare("SELECT * FROM nbtc_minting WHERE tx_id = ?")
			.bind(txid)
			.first<NbtcTxRow>();

		if (!tx) {
			return null;
		}

		const blockHeight = tx.block_height as number;
		const confirmations = blockHeight ? latestHeight - blockHeight + 1 : 0;

		return {
			...tx,
			btc_tx_id: tx.tx_id,
			status: tx.status as NbtcTxStatus,
			block_height: blockHeight,
			confirmations: confirmations > 0 ? confirmations : 0,
		};
	}

	async getStatusBySuiAddress(suiAddress: string): Promise<NbtcTxStatusResp[]> {
		const latestHeightStr = await this.blocksDB.get("chain_tip");
		const latestHeight = latestHeightStr ? parseInt(latestHeightStr, 10) : 0;

		const dbResult = await this.d1
			.prepare("SELECT * FROM nbtc_minting WHERE sui_recipient = ? ORDER BY created_at DESC")
			.bind(suiAddress)
			.all<NbtcTxRow>();

		if (!dbResult.results) {
			return [];
		}

		return dbResult.results.map((tx): NbtcTxStatusResp => {
			const blockHeight = tx.block_height as number;
			const confirmations = blockHeight ? latestHeight - blockHeight + 1 : 0;
			return {
				...tx,
				btc_tx_id: tx.tx_id,
				status: tx.status as NbtcTxStatus,
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

		const now = Date.now();
		const insertStmt = this.d1.prepare(
			`INSERT OR IGNORE INTO nbtc_minting (tx_id, vout, sui_recipient, amount_sats, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'broadcasting', ?, ?)`,
		);

		const statements = deposits.map((deposit) =>
			insertStmt.bind(txId, deposit.vout, deposit.suiRecipient, deposit.amountSats, now, now),
		);

		try {
			await this.d1.batch(statements);
		} catch (e) {
			console.error({
				msg: "Failed to register broadcasted nBTC transaction",
				error: toSerializableError(e),
				txId,
			});
			throw e;
		}

		console.log({
			msg: "New nBTC minting deposit TX registered",
			txId,
			registeredCount: statements.length,
		});
		return { tx_id: txId, registered_deposits: statements.length };
	}

	async getLatestHeight(): Promise<{ height: number | null }> {
		const result = await this.d1
			.prepare("SELECT MAX(height) as height FROM btc_blocks")
			.first<{ height: number | null }>();

		if (result) {
			return result;
		} else {
			return { height: null };
		}
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
