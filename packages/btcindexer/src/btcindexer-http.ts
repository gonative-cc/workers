import type { IRequest } from "itty-router";
import { parseBlocksFromStream } from "./btcblock";
import { Indexer } from "./btcindexer";
import { networks } from "bitcoinjs-lib";
import { SuiClient } from "./sui-client";

const NBTC_MODULE = "nbtc";
const MINT_FUNCTION = "mint";

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
			suiNetwork: env.SUI_NETWORK,
			suiPackageId: env.SUI_PACKAGE_ID,
			suiModule: NBTC_MODULE,
			suiFunction: MINT_FUNCTION,
			suiNbtcObjectId: env.NBTC_OBJECT_ID,
			suiLightClientObjectId: env.LIGHT_CLIENT_OBJECT_ID,
			suiSignerMnemonic: env.SUI_SIGNER_MNEMONIC,
		});
		return new Indexer(
			env,
			this.nbtcAddr,
			this.suiFallbackAddr,
			this.btcNetwork,
			suiClient,
		);
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
