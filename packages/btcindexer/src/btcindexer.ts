import { ExtBlock, Transaction, Block } from "./btcblock";
import { address, networks } from "bitcoinjs-lib";
import { OP_RETURN } from "./opcodes";

const CONFIRMATION_DEPTH = 8;

interface Deposit {
	vout: number;
	amountSats: number;
	suiRecipient: string;
}

export class Indexer {
	d1: D1Database; // SQL DB
	blocksDB: KVNamespace;
	nbtcTxDB: KVNamespace;
	nbtcScriptHex: string;
	suiFallbackAddr: string;

	constructor(env: Env, nbtcAddr: string, fallbackAddr: string, network: networks.Network) {
		this.d1 = env.DB;
		this.blocksDB = env.btc_blocks;
		this.nbtcTxDB = env.nbtc_txs;
		this.suiFallbackAddr = fallbackAddr;
		this.nbtcScriptHex = address.toOutputScript(nbtcAddr, network).toString("hex");
	}

	// returns number of processed and add blocks
	async putBlocks(blocks: ExtBlock[]): Promise<number> {
		if (!blocks || blocks.length === 0) {
			return 0;
		}
		const insertBlockStmt = this.d1.prepare(
			`INSERT INTO processed_blocks (height, hash) VALUES (?, ?)`
		);
		const putKVs = blocks.map((b) => this.blocksDB.put(b.getId(), b.raw));
		const putD1s = blocks.map((b) => insertBlockStmt.bind(b.height, b.getHash()));

		try {
			await Promise.all([...putKVs, this.d1.batch(putD1s)]);
		} catch (e) {
			console.error(`Failed to store one or more blocks in KV or D1:`, e);
			// TODO: decide what to do in the case where some blocks were saved and some not, prolly we need more granular error
			throw new Error(`Could not save all blocks data`);
		}
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
		const blocksToProcess = await this.d1
			.prepare("SELECT height, hash FROM processed_blocks ORDER BY height ASC LIMIT 10")
			.all<{ height: number; hash: string }>();

		if (!blocksToProcess.results || blocksToProcess.results.length === 0) {
			return;
		}

		const nbtcTxStatements: D1PreparedStatement[] = [];

		const insertNbtcTxStmt = this.d1.prepare(
			"INSERT INTO nbtc_txs (tx_id, block_hash, block_height, vout, sui_recipient, amount_sats, status) VALUES (?, ?, ?, ?, ?, ?, ?)"
		);

		for (const blockInfo of blocksToProcess.results) {
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
							"confirming"
						)
					);
				}
			}
		}

		if (nbtcTxStatements.length > 0) await this.d1.batch(nbtcTxStatements);

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

		for (let i = 0; i < tx.outs.length; i++) {
			const vout = tx.outs[i];
			if (vout.script.toString("hex") === this.nbtcScriptHex) {
				deposits.push({
					vout: i,
					amountSats: Number(vout.value),
					suiRecipient,
				});
			}
		}
		return deposits;
	}

	async updateConfirmationsAndFinalize(): Promise<void> {
		const latestBlock = await this.d1
			.prepare("SELECT MAX(height) as latest_height FROM processed_blocks")
			.first<{ latest_height: number }>();
		const latestHeight = latestBlock?.latest_height;

		if (!latestHeight) {
			return;
		}

		const pendingTxs = await this.d1
			.prepare(
				"SELECT tx_id, block_hash, block_height FROM nbtc_txs WHERE status = 'confirming'"
			)
			.all<{ tx_id: string; block_hash: string; block_height: number }>();

		if (!pendingTxs.results || pendingTxs.results.length === 0) {
			return;
		}

		const reorgUpdates = await this.handleReorgs(pendingTxs.results);
		const finalizationUpdates = this.findFinalizedTxs(pendingTxs.results, latestHeight);
		const allUpdates = [...reorgUpdates, ...finalizationUpdates];

		if (allUpdates.length > 0) {
			await this.d1.batch(allUpdates);
		}
	}

	async handleReorgs(
		pendingTxs: { tx_id: string; block_hash: string; block_height: number }[]
	): Promise<D1PreparedStatement[]> {
		const updates: D1PreparedStatement[] = [];
		const reorgCheckStmt = this.d1.prepare(
			"SELECT hash FROM processed_blocks WHERE height = ?"
		);
		const reorgStmt = this.d1.prepare(
			"UPDATE nbtc_txs SET status = 'broadcasting', block_hash = NULL, block_height = NULL, updated_at = CURRENT_TIMESTAMP WHERE tx_id = ?"
		);

		for (const tx of pendingTxs) {
			const blockAtHeight = await reorgCheckStmt
				.bind(tx.block_height)
				.first<{ hash: string }>();

			if (!blockAtHeight || blockAtHeight.hash !== tx.block_hash) {
				//TODO: we should use a proper logger
				console.warn(
					`Reorg detected for tx ${tx.tx_id} at height ${tx.block_height}. Resetting status.`
				);
				updates.push(reorgStmt.bind(tx.tx_id));
			}
		}
		return updates;
	}

	findFinalizedTxs(
		pendingTxs: { tx_id: string; block_height: number }[],
		latestHeight: number
	): D1PreparedStatement[] {
		const updates: D1PreparedStatement[] = [];
		const finalizeStmt = this.d1.prepare(
			"UPDATE nbtc_txs SET status = 'finalized', updated_at = CURRENT_TIMESTAMP WHERE tx_id = ?"
		);

		for (const tx of pendingTxs) {
			const confirmations = latestHeight - tx.block_height + 1;
			if (confirmations >= CONFIRMATION_DEPTH) {
				updates.push(finalizeStmt.bind(tx.tx_id));
			}
		}
		return updates;
	}
}
