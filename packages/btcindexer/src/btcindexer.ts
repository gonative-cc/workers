import { ExtendedBlock, Transaction } from './btcblock';

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
	async putBlocks(blocks: ExtendedBlock[]): Promise<number> {
		if (!blocks || blocks.length === 0) {
			return 0;
		}
		const putPromises = blocks.map((b) => this.blocksDB.put(b.getId(), b.raw));
		try {
			await Promise.all(putPromises);
		} catch (e) {
			console.error(`Failed to store one or more blocks in KV:`, e);
		}
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
