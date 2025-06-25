import { Block, Transaction } from './btcblock';

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
	async putBlocks(blocks: Block[]): Promise<number> {
		for (const b of blocks) {
			this.blocksDB.put(b.getId(), b.toBuffer());
			// TODO: index nBTC txs
			// TODO: save light blocks in d1
			// TODO: index nBTC txs in d1
			// TODO: save raw nBTC txs in DB
		}
		return 0;
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
