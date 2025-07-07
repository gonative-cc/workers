import { ExtBlock, Transaction } from './btcblock';

export class Indexer {
	d1: D1Database; // SQL DB
	blocksDB: KVNamespace;
	nbtcTxDB: KVNamespace;
	nbtcAddr: string;

	constructor(env: Env, nbtcAddr: string) {
		this.d1 = env.DB;
		this.blocksDB = env.btc_blocks;
		this.nbtcTxDB = env.nbtc_txs;
		this.nbtcAddr = nbtcAddr;
	}

	// returns number of processed and add blocks
	async putBlocks(blocks: ExtBlock[]): Promise<number> {
		if (!blocks || blocks.length === 0) {
			return 0;
		}
		const insertBlockStmt = this.d1.prepare(`INSERT INTO processed_blocks (height, block_id) VALUES (?, ?)`);
		const putKVs = blocks.map((b) => this.blocksDB.put(b.getId(), b.raw));
		// TODO: the height is not part of the block itself. Probably we will need to send it from the relayer, sending blocks {height, raw}
		const putD1s = blocks.map((b) => insertBlockStmt.bind(0, b.getHash()));
		try {
			await Promise.all([...putKVs, this.d1.batch(putD1s)]);
		} catch (e) {
			console.error(`Failed to store one or more blocks in KV or D1:`, e);
			// TODO: decide what to do in the case where some blocks were saved and some not, prolly we need more granular error
			throw new Error(`Could not save all blocks data`);
		}
		// TODO: parse the raw blocks and scan them for NBTC transactions, then insert them into the nBTC txs table.
		// TODO: index nBTC txs
		// TODO: save light blocks in d1
		// TODO: index nBTC txs in d1
		// TODO: save raw nBTC txs in DB
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
}
