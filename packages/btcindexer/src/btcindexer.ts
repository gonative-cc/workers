import { Block } from './btcblock';

export class Indexer {
	d1: D1Database;
	blocksDB: KVNamespace;
	nbtcAddr: string;

	constructor(env: Env, nbtcAddr: string) {
		this.d1 = env.DB;
		this.blocksDB = env.btcblocks;
		this.nbtcAddr = nbtcAddr;
	}

	// returns number of processed and add blocks
	async putBlocks(blocks: Block[]): Promise<number> {
		for (const b of blocks) {
			this.blocksDB.put(b.getId(), b.toBuffer());
			// TODO: index nBTC txs
		}
		return 0;
	}

	// returns true if tx has not been processed yet, false if it was already inserted
	async putNbtcTx(): Promise<boolean> {
		// TODO
		// 1. check if tx is nBTC segwit payment
		// 2. check if not duplicated
		// 3. insert in D1
		//

		return true;
	}
}
