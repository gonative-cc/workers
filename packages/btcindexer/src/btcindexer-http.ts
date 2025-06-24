import type { IRequest } from 'itty-router';
import { parseBlocks } from './btcblock';
import { Indexer } from './btcindexer';

export class HIndexer {
	public nbtcAddr: string;

	constructor() {
		this.nbtcAddr = 'TODO';
	}

	// NOTE: we may need to put this to a separate worker
	async putBlocks(req: IRequest, env: Env) {
		const blocks = parseBlocks(req.body);
		const i = new Indexer(env, this.nbtcAddr);
		return { number: await i.putBlocks(blocks) };
	}

	async putNbtcTx(req: IRequest, env: Env) {
		const i = new Indexer(env, this.nbtcAddr);
		return { inserted: await i.putNbtcTx() };
	}
}
