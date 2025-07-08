import type { IRequest } from "itty-router";
import { parseBlocksFromStream } from "./btcblock";
import { Indexer } from "./btcindexer";
import { networks } from "bitcoinjs-lib";

export class HIndexer {
	public nbtcAddr: string;
	public fallbackAddr: string;
	public network: networks.Network;

	constructor() {
		// TODO: need to provide through env variable
		this.nbtcAddr = "TODO";
		this.fallbackAddr = "TODO";
		this.network = networks.regtest;
	}

	newIndexer(env: Env): Indexer {
		return new Indexer(env, this.nbtcAddr, this.fallbackAddr, this.network);
	}

	// NOTE: we may need to put this to a separate worker
	async putBlocks(req: IRequest, env: Env) {
		const blocks = await parseBlocksFromStream(req.body);
		const i = this.newIndexer(env);
		return { number: await i.putBlocks(blocks) };
	}

	async putNbtcTx(req: IRequest, env: Env) {
		const i = this.newIndexer(env);
		return { inserted: await i.putNbtcTx() };
	}
}
