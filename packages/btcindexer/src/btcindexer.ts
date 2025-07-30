import { PutBlocks } from "./api/put-blocks";
import { address, networks, Block, Transaction } from "bitcoinjs-lib";
import { OP_RETURN } from "./opcodes";
import { MerkleTree } from "merkletreejs";
import SHA256 from "crypto-js/sha256";
import SuiClient from "./sui_client";

const CONFIRMATION_DEPTH = 8;

export interface Deposit {
	vout: number;
	amountSats: number;
	suiRecipient: string;
}

export interface ProofResult {
	proofPath: Buffer[];
	merkleRoot: string;
}

export interface PendingTx {
	tx_id: string;
	block_hash: string | null;
	block_height: number;
}

interface BlockRecord {
	tx_id: string;
	block_hash: string;
	block_height: number;
}

export class Indexer {
	d1: D1Database; // SQL DB
	blocksDB: KVNamespace;
	nbtcTxDB: KVNamespace;
	nbtcScriptHex: string;
	suiFallbackAddr: string;
	nbtcClient: SuiClient;

	constructor(
		env: Env,
		nbtcAddr: string,
		fallbackAddr: string,
		network: networks.Network,
		suiClient: SuiClient,
	) {
		this.d1 = env.DB;
		this.blocksDB = env.btc_blocks;
		this.nbtcTxDB = env.nbtc_txs;
		this.suiFallbackAddr = fallbackAddr;
		this.nbtcScriptHex = address.toOutputScript(nbtcAddr, network).toString("hex");
		this.nbtcClient = suiClient;
	}

	// returns number of processed and add blocks
	async putBlocks(blocks: PutBlocks[]): Promise<number> {
		console.log("INSERTING:", blocks.length);
		if (!blocks || blocks.length === 0) {
			return 0;
		}

		const insertBlockStmt = this.d1.prepare(
			`INSERT INTO processed_blocks (height, hash) VALUES (?, ?)
			 ON CONFLICT(height) DO UPDATE SET hash = excluded.hash
			 WHERE processed_blocks.hash IS NOT excluded.hash`,
		);

		// TODO: store in KV
		const putKVs = blocks.map((b) => this.blocksDB.put(b.block.getId(), b.block.toBuffer()));
		const putD1s = blocks.map((b) => insertBlockStmt.bind(b.height, b.height));

		try {
			await Promise.all([...putKVs, this.d1.batch(putD1s)]);
		} catch (e) {
			console.error(`Failed to store one or more blocks in KV or D1:`, e);
			// TODO: decide what to do in the case where some blocks were saved and some not, prolly we need more granular error
			throw new Error(`Could not save all blocks data`);
		}
		console.log("<< >>INSERTED");
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
		console.log("Cron: Running scanNewBlocks");
		const blocksToProcess = await this.d1
			.prepare("SELECT height, hash FROM processed_blocks ORDER BY height ASC LIMIT 10")
			.all<{ height: number; hash: string }>();

		if (!blocksToProcess.results || blocksToProcess.results.length === 0) {
			return;
		}

		const blockCount = blocksToProcess.results.length;
		console.log(`Cron: Found ${blockCount} block(s) to process`);

		const nbtcTxStatements: D1PreparedStatement[] = [];

		const insertNbtcTxStmt = this.d1.prepare(
			"INSERT INTO nbtc_txs (tx_id, block_hash, block_height, vout, sui_recipient, amount_sats, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
		);

		for (const blockInfo of blocksToProcess.results) {
			console.log(`Cron: Scanning block at height ${blockInfo.height}`);
			const rawBlockBuffer = await this.blocksDB.get(blockInfo.hash, {
				type: "arrayBuffer",
			});
			if (!rawBlockBuffer) {
				continue;
			}
			const block = Block.fromBuffer(Buffer.from(rawBlockBuffer));

			for (const tx of block.transactions ?? []) {
				const deposits = this.findNbtcDeposits(tx);
				for (const deposit of deposits) {
					nbtcTxStatements.push(
						insertNbtcTxStmt.bind(
							tx.getId(),
							blockInfo.hash,
							blockInfo.height,
							deposit.vout,
							deposit.suiRecipient,
							deposit.amountSats,
							"confirming",
						),
					);
				}
			}
		}

		if (nbtcTxStatements.length > 0) {
			console.log(
				`Cron: Found ${nbtcTxStatements.length} new nBTC deposit(s). Storing in D1`,
			);
			await this.d1.batch(nbtcTxStatements);
		} else {
			console.log(`Cron: No new nBTC deposits found in the scanned blocks`);
		}

		const heightsToDelete = blocksToProcess.results.map((r) => r.height);
		const heights = heightsToDelete.join(",");
		const deleteStmt = `DELETE FROM processed_blocks WHERE height IN (${heights})`;
		await this.d1.prepare(deleteStmt).run();
	}

	findNbtcDeposits(tx: Transaction): Deposit[] {
		const deposits: Deposit[] = [];
		let suiRecipient: string | null = null;

		for (const vout of tx.outs) {
			if (vout.script[0] === OP_RETURN) {
				suiRecipient = vout.script.subarray(2).toString();
				break; // valid tx should have only one OP_RETURN
			}
		}
		// TODO: add more sophisticated validation for Sui address
		if (!suiRecipient) suiRecipient = this.suiFallbackAddr;
		console.log(`Checking TX ${tx.getId()} for deposits. Target script: ${this.nbtcScriptHex}`);

		for (let i = 0; i < tx.outs.length; i++) {
			const vout = tx.outs[i];
			if (vout.script.toString("hex") === this.nbtcScriptHex) {
				console.log(`<<Found matching nBTC deposit!>>`);
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
				"SELECT tx_id, block_hash, block_height as height FROM nbtc_txs WHERE status = 'finalized'",
			)
			.all<BlockRecord>();

		if (!finalizedTxs.results || finalizedTxs.results.length === 0) {
			console.log("Minting: No finalized transactions found to process");
			return;
		}
		console.log(
			`Minting: Found ${finalizedTxs.results.length} finalized transaction(s). Preparing to mint`,
		);

		const mintBatchArgs = [];
		const processedTxIds: { tx_id: string; success: boolean }[] = [];

		for (const txInfo of finalizedTxs.results) {
			try {
				const rawBlockBuffer = await this.blocksDB.get(txInfo.block_hash, {
					type: "arrayBuffer",
				});
				if (!rawBlockBuffer) continue;

				const block = Block.fromBuffer(Buffer.from(rawBlockBuffer));
				const merkleTree = this.constructMerkleTree(block);
				if (!merkleTree) continue;

				const txIndex = block.transactions?.findIndex((tx) => tx.getId() === txInfo.tx_id);
				const targetTx = block.transactions?.[txIndex ?? -1];
				if (!targetTx || txIndex === undefined || txIndex === -1) continue;

				const proof = this.getTxProof(merkleTree, targetTx);
				// soundness check
				if (
					!proof ||
					(block.merkleRoot !== undefined &&
						proof.merkleRoot !==
							Buffer.from(block.merkleRoot).reverse().toString("hex"))
				) {
					console.warn(
						`WARN: Failed to generate a valid merkle proof for TX ${txInfo.tx_id}. Skipping`,
					);
					continue;
				}

				mintBatchArgs.push({
					transaction: targetTx,
					blockHeight: txInfo.block_height,
					txIndex: txIndex,
					proof: proof,
				});
				processedTxIds.push({ tx_id: txInfo.tx_id, success: true });
			} catch (e) {
				console.error(`Minting: ERROR preparing TX ${txInfo.tx_id}:`, e);
				processedTxIds.push({ tx_id: txInfo.tx_id, success: false });
			}
		}

		if (mintBatchArgs.length > 0) {
			console.log(`Minting: Sending batch of ${mintBatchArgs.length} mints to SUI...`);
			const batchSuccess = await this.nbtcClient.tryMintNbtcBatch(mintBatchArgs);

			// If the whole batch fails, mark them all as failed
			// TODO: decide what to do with the failed mints
			if (!batchSuccess) {
				processedTxIds.forEach((p) => {
					if (p.success) p.success = false;
				});
			}
		}
		const setMintedStmt = this.d1.prepare(
			"UPDATE nbtc_txs SET status = 'minted', updated_at = CURRENT_TIMESTAMP WHERE tx_id = ?",
		);
		const setFailedStmt = this.d1.prepare(
			"UPDATE nbtc_txs SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE tx_id = ?",
		);
		const updates = processedTxIds.map((p) =>
			p.success ? setMintedStmt.bind(p.tx_id) : setFailedStmt.bind(p.tx_id),
		);

		if (updates.length > 0) {
			console.log(`Minting: Updating status for ${updates.length} transactions in D1.`);
			await this.d1.batch(updates);
		}
	}

	constructMerkleTree(block: Block): MerkleTree | null {
		if (!block.transactions || block.transactions.length === 0) {
			return null;
		}
		// NOTE: `tx.getHash()` from `bitcoinjs-lib` returns numbers as a bytes in the little-endian
		// format - same as Bitcoin Core
		// However, the MerkleTree from the `merkletreejs` library expects its leaves to be in the
		// big-endian format. So we reverse each hash to convert them big-endian.
		const leaves = block.transactions.map((tx) => Buffer.from(tx.getHash()).reverse());
		return new MerkleTree(leaves, SHA256, { isBitcoinTree: true });
	}

	getTxProof(tree: MerkleTree, targetTx: Transaction): ProofResult | null {
		const targetLeaf = Buffer.from(targetTx.getHash()).reverse();
		const proofPath = tree.getProof(targetLeaf).map((p) => p.data);
		const merkleRoot = tree.getRoot().toString("hex");
		return { proofPath, merkleRoot };
	}

	async updateConfirmationsAndFinalize(latestHeight: number): Promise<void> {
		const pendingTxs = await this.d1
			.prepare(
				"SELECT tx_id, block_hash, block_height FROM nbtc_txs WHERE status = 'confirming'",
			)
			.all<{ tx_id: string; block_hash: string; block_height: number }>();

		if (!pendingTxs.results || pendingTxs.results.length === 0) {
			console.log("Finalization: No transactions in 'confirming' state to check");
			return;
		}
		console.log(
			`Finalization: Found ${pendingTxs.results.length} transaction(s) in 'confirming' state`,
		);

		const { reorgUpdates, reorgedTxIds } = await this.handleReorgs(pendingTxs.results);
		// TODO: add a unit test for it so we make sure we do not finalize reorrged tx.
		const validPendingTxs = pendingTxs.results.filter((tx) => !reorgedTxIds.includes(tx.tx_id));
		const finalizationUpdates = this.selectFinalizedNbtcTxs(validPendingTxs, latestHeight);
		const allUpdates = [...reorgUpdates, ...finalizationUpdates];

		if (allUpdates.length > 0) {
			try {
				await this.d1.batch(allUpdates);
			} catch (e) {
				console.error(`failed to apply batch updates to D1.`, e);
			}
		}
	}

	async handleReorgs(
		pendingTxs: PendingTx[],
	): Promise<{ reorgUpdates: D1PreparedStatement[]; reorgedTxIds: string[] }> {
		const reorgUpdates: D1PreparedStatement[] = [];
		const reorgedTxIds: string[] = [];
		const reorgCheckStmt = this.d1.prepare(
			"SELECT hash FROM processed_blocks WHERE height = ?",
		);
		const reorgStmt = this.d1.prepare(
			"UPDATE nbtc_txs SET status = 'reorg', updated_at = CURRENT_TIMESTAMP WHERE tx_id = ?",
		);

		for (const tx of pendingTxs) {
			const newBlockInQueue = await reorgCheckStmt
				.bind(tx.block_height)
				.first<{ hash: string }>();

			if (newBlockInQueue) {
				if (newBlockInQueue.hash !== tx.block_hash) {
					console.warn(
						`Reorg detected for tx ${tx.tx_id} at height ${tx.block_height}. Old hash: ${tx.block_hash}, New hash: ${newBlockInQueue.hash}.`,
					);
					reorgUpdates.push(reorgStmt.bind(tx.tx_id));
					reorgedTxIds.push(tx.tx_id);
				}
			}
		}
		return { reorgUpdates, reorgedTxIds };
	}

	selectFinalizedNbtcTxs(pendingTxs: PendingTx[], latestHeight: number): D1PreparedStatement[] {
		const updates: D1PreparedStatement[] = [];
		const finalizeStmt = this.d1.prepare(
			"UPDATE nbtc_txs SET status = 'finalized', updated_at = CURRENT_TIMESTAMP WHERE tx_id = ?",
		);

		for (const tx of pendingTxs) {
			const confirmations = latestHeight - tx.block_height + 1;
			if (confirmations >= CONFIRMATION_DEPTH) {
				console.log(
					`Transaction ${tx.tx_id} has ${confirmations} confirmations. Finalizing.`,
				);
				updates.push(finalizeStmt.bind(tx.tx_id));
			}
		}
		return updates;
	}
}
