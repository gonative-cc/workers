import type { IRequest } from "itty-router";
import { parseBlocksFromStream } from "./btcblock";
import { Indexer } from "./btcindexer";
import { networks } from "bitcoinjs-lib";
import SuiClient from "./sui_client";

const NBTC_MODULE = "nbtc";

export class HIndexer {
	public nbtcAddr: string;
	public suiFallbackAddr: string;
	public btcNetwork: networks.Network;

	constructor() {
		// TODO: need to provide through env variable
		this.nbtcAddr = "TODO";
		this.suiFallbackAddr = "TODO";
		this.btcNetwork = networks.regtest;
	}

	newIndexer(env: Env): Indexer {
		const suiClient = new SuiClient({
			network: env.SUI_NETWORK,
			nbtcPkg: env.SUI_PACKAGE_ID,
			nbtcModule: NBTC_MODULE,
			nbtcObjectId: env.NBTC_OBJECT_ID,
			lightClientObjectId: env.LIGHT_CLIENT_OBJECT_ID,
			signerMnemonic: env.SUI_SIGNER_MNEMONIC,
		});
		return new Indexer(
			env,
			this.nbtcAddr,
			this.suiFallbackAddr,
			this.btcNetwork,
			suiClient,
		);
	}

	// NOTE: for handlers we user arrow function to avoid `bind` calls when using class methods
	// in callbacks.

	// NOTE: we may need to put this to a separate worker
	putBlocks = async (req: IRequest, env: Env) => {
		const blocks = await parseBlocksFromStream(req.body);
		const i = this.newIndexer(env);
		return { number: await i.putBlocks(blocks) };
	};

	putNbtcTx = async (req: IRequest, env: Env) => {
		const i = this.newIndexer(env);
		return { inserted: await i.putNbtcTx() };
	};

	// TODO: remove this
	putTestKV = async (req: IRequest, env: Env) => {
		const kv = env.btc_blocks;
		const data = await req.json<{ key: string; val: string }>();
		if (!data.key || !data.val)
			return new Error("Wrong Request: body must by {key, val} JSON");

		console.log("recording to btc_blocks");
		await kv.put(data.key, data.val);
		const allKeys = await kv.list();
		return allKeys;
		// return 1;
	};
}
