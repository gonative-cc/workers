import type { IRequest } from 'itty-router';
import { parseBlocks } from './btcblock';
import { Indexer } from './btcindexer';

export class HIndexer {
	public nbtcAddr: string;

	constructor() {
		// TODO: need to provide through env variable
		this.nbtcAddr = 'TODO';
	}

	newIndexer(env: Env): Indexer {
		return new Indexer(env, this.nbtcAddr);
	}

	// NOTE: we may need to put this to a separate worker
	async putBlocks(req: IRequest, env: Env) {
		const blocks = parseBlocks(req.body);
		const i = this.newIndexer(env);
		return { number: await i.putBlocks(blocks) };
	}

	async putNbtcTx(req: IRequest, env: Env) {
		const i = this.newIndexer(env);
		return { inserted: await i.putNbtcTx() };
	}
}
