import { PutBlocks } from "./api/put-blocks";
import { address, networks, Block, Transaction } from "bitcoinjs-lib";
import { OP_RETURN } from "./opcodes";
import { BitcoinMerkleTree } from "./bitcoin-merkle-tree";
import SuiClient, { suiClientFromEnv } from "./sui_client";
import {
	Deposit,
	PendingTx,
	BlockRecord,
	Storage,
	NbtcTxStatus,
	NbtcTxStatusResp,
	NbtcTxD1Row,
	MintBatchArg,
} from "./models";

const CONFIRMATION_DEPTH = 8;

export function storageFromEnv(env: Env): Storage {
	return { d1: env.DB, blocksDB: env.btc_blocks, nbtcTxDB: env.nbtc_txs };
}

const btcNetworks = {
	mainnet: networks.bitcoin,
	testnet: networks.testnet,
	regtest: networks.regtest,
};
const validBtcNet = Object.keys(btcNetworks).keys();

export function indexerFromEnv(env: Env): Indexer {
	const storage = storageFromEnv(env);
	const sc = suiClientFromEnv(env);

	if (!env.BITCOIN_NETWORK) throw Error("BITCOIN_NETWORK env must be set");
	if (!(env.BITCOIN_NETWORK in btcNetworks))
		throw new Error("Invalid BITCOIN_NETWORK value. Must be in " + validBtcNet);
	const btcNet = btcNetworks[env.BITCOIN_NETWORK];

	return new Indexer(storage, sc, env.NBTC_DEPOSIT_ADDRESS, env.SUI_FALLBACK_ADDRESS, btcNet);
}

export class Indexer implements Storage {
	d1: D1Database; // SQL DB
	blocksDB: KVNamespace;
	nbtcTxDB: KVNamespace;

	nbtcScriptHex: string;
	suiFallbackAddr: string;
	nbtcClient: SuiClient;

	constructor(
		storage: Storage,
		suiClient: SuiClient,
		nbtcAddr: string,
		fallbackAddr: string,
		network: networks.Network,
	) {
		this.d1 = storage.d1;
		this.blocksDB = storage.blocksDB;
		this.nbtcTxDB = storage.nbtcTxDB;
		this.nbtcClient = suiClient;
		this.suiFallbackAddr = fallbackAddr;
		this.nbtcScriptHex = address.toOutputScript(nbtcAddr, network).toString("hex");
	}

	// returns number of processed and add blocks
	async putBlocks(blocks: PutBlocks[]): Promise<number> {
		console.log("INSERTING:", blocks.length);
		if (!blocks || blocks.length === 0) {
			return 0;
		}

		const insertBlockStmt = this.d1.prepare(
			`INSERT INTO btc_blocks (height, hash, status) VALUES (?, ?, 'new')
			 ON CONFLICT(height) DO UPDATE SET hash = excluded.hash
			 WHERE btc_blocks.hash IS NOT excluded.hash`,
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
			.prepare(
				"SELECT height, hash FROM btc_blocks WHERE status = 'new' ORDER BY height ASC LIMIT 10",
			)
			.all<{ height: number; hash: string }>();

		if (!blocksToProcess.results || blocksToProcess.results.length === 0) {
			return;
		}

		const blockCount = blocksToProcess.results.length;
		console.log(`Cron: Found ${blockCount} block(s) to process`);

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
			console.log(
				`Cron: Found ${nbtcTxStatements.length} new nBTC deposit(s). Storing in D1`,
			);
			await this.d1.batch(nbtcTxStatements);
		} else {
			console.log(`Cron: No new nBTC deposits found in the scanned blocks`);
		}

		const latestHeightProcessed = Math.max(...blocksToProcess.results.map((b) => b.height));
		await this.blocksDB.put("chain_tip", latestHeightProcessed.toString());
		console.log(`Cron: Updated chain_tip to ${latestHeightProcessed}`);

		const heightsToUpdate = blocksToProcess.results.map((r) => r.height);
		if (heightsToUpdate.length > 0) {
			const placeholders = heightsToUpdate.map(() => "?").join(",");
			const updateStmt = `UPDATE btc_blocks SET status = 'scanned' WHERE height IN (${placeholders})`;
			await this.d1
				.prepare(updateStmt)
				.bind(...heightsToUpdate)
				.run();
		}
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
				"SELECT tx_id, block_hash, block_height FROM nbtc_minting WHERE status = 'finalized'",
			)
			.all<BlockRecord>();

		if (!finalizedTxs.results || finalizedTxs.results.length === 0) {
			console.log("Minting: No finalized transactions found to process");
			return;
		}
		console.log(
			`Minting: Found ${finalizedTxs.results.length} finalized transaction(s). Preparing to mint`,
		);

		const mintBatchArgs: MintBatchArg[] = [];
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
				const calculatedRoot = merkleTree.getRoot();
				if (
					!proof ||
					(block.merkleRoot !== undefined && !block.merkleRoot.equals(calculatedRoot))
				) {
					console.warn(
						`WARN: Failed to generate a valid merkle proof for TX ${txInfo.tx_id}. Root mismatch.`,
						`Block root: ${block.merkleRoot?.toString(
							"hex",
						)}, Calculated: ${calculatedRoot.toString("hex")}`,
					);
					continue;
				}

				mintBatchArgs.push({
					tx: targetTx,
					blockHeight: txInfo.block_height,
					txIndex: txIndex,
					proof: { proofPath: proof, merkleRoot: calculatedRoot.toString("hex") },
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
		const now = Date.now();
		const setMintedStmt = this.d1.prepare(
			`UPDATE nbtc_minting SET status = 'minted', updated_at = ${now} WHERE tx_id = ?`,
		);
		const setFailedStmt = this.d1.prepare(
			`UPDATE nbtc_minting SET status = 'failed', updated_at = ${now} WHERE tx_id = ?`,
		);
		const updates = processedTxIds.map((p) =>
			p.success ? setMintedStmt.bind(p.tx_id) : setFailedStmt.bind(p.tx_id),
		);

		if (updates.length > 0) {
			console.log(`Minting: Updating status for ${updates.length} transactions in D1.`);
			await this.d1.batch(updates);
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
			console.error(`Failed to get proof:`, e);
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
		const now = Date.now();
		const finalizeStmt = this.d1.prepare(
			`UPDATE nbtc_minting SET status = 'finalized', updated_at = ${now} WHERE tx_id = ?`,
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

	async getStatusByTxid(txid: string): Promise<NbtcTxStatusResp | null> {
		const latestHeightStr = await this.blocksDB.get("chain_tip");
		const latestHeight = latestHeightStr ? parseInt(latestHeightStr, 10) : 0;

		const tx = await this.d1
			.prepare("SELECT * FROM nbtc_minting WHERE tx_id = ?")
			.bind(txid)
			.first<NbtcTxD1Row>();

		if (!tx) {
			return null;
		}

		const blockHeight = tx.block_height as number;
		const confirmations = blockHeight ? latestHeight - blockHeight + 1 : 0;

		return {
			btc_tx_id: tx.tx_id,
			status: tx.status as NbtcTxStatus,
			block_height: blockHeight,
			confirmations: confirmations > 0 ? confirmations : 0,
			sui_recipient: tx.sui_recipient,
			amount_sats: tx.amount_sats,
		};
	}

	async getStatusBySuiAddress(suiAddress: string): Promise<NbtcTxStatusResp[]> {
		const latestHeightStr = await this.blocksDB.get("chain_tip");
		const latestHeight = latestHeightStr ? parseInt(latestHeightStr, 10) : 0;

		const dbResult = await this.d1
			.prepare("SELECT * FROM nbtc_minting WHERE sui_recipient = ? ORDER BY created_at DESC")
			.bind(suiAddress)
			.all<NbtcTxD1Row>();

		if (!dbResult.results) {
			return [];
		}

		return dbResult.results.map((tx): NbtcTxStatusResp => {
			const blockHeight = tx.block_height as number;
			const confirmations = blockHeight ? latestHeight - blockHeight + 1 : 0;
			return {
				btc_tx_id: tx.tx_id,
				status: tx.status as NbtcTxStatus,
				block_height: blockHeight,
				confirmations: confirmations > 0 ? confirmations : 0,
				sui_recipient: tx.sui_recipient,
				amount_sats: tx.amount_sats,
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

		await this.d1.batch(statements);

		console.log(`Successfully registered ${statements.length} deposit(s) for nBTC tx ${txId}.`);
		return { tx_id: txId, registered_deposits: statements.length };
	}
}
