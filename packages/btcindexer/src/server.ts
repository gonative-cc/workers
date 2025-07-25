import { IRequest, Router, error, json } from "itty-router";
import { networks } from "bitcoinjs-lib";

import { parseBlocksFromStream } from "./btcblock";
import { Indexer } from "./btcindexer";
import SuiClient from "./sui_client";
import { RestPath } from "./rpc/client";

import type { AppRouter, CFArgs } from "./routertype";

const NBTC_MODULE = "nbtc";

export default class HttpServer {
	nbtcAddr: string;
	suiFallbackAddr: string;
	btcNetwork: networks.Network;

	router: AppRouter;

	constructor() {
		// TODO: need to provide through env variable
		this.nbtcAddr = "TODO";
		this.suiFallbackAddr = "TODO";
		this.btcNetwork = networks.regtest;

		this.router = this.createRouter();
	}

	createRouter() {
		const r = Router<IRequest, CFArgs>({
			catch: error,
			// convert non `Response` objects to JSON Responses. If a handler returns `Response`
			// object then it will be directly returned.
			finally: [json],
		});

		r.put(RestPath.blocks, this.putBlocks);
		r.put(RestPath.nbtcTx, this.putNbtcTx);

		//
		// TESTING
		// we can return Response object directly, to avoid JSON serialization
		r.get("/test/user/:id", (req) => new Response(`User ID: ${req.params.id}`));
		// curl http://localhost:8787/test/kv/ -X PUT -d '{"key": "k102", "val": "v1"}'
		r.put("/test/kv", this.putTestKV);
		// curl "http://localhost:8787/test/kv/1" -i
		r.get("/test/kv/:key", this.getTestKV);
		r.get("/test", (req: Request) => {
			const url = new URL(req.url);
			url.pathname = "/__scheduled";
			url.searchParams.append("cron", "* * * * *");
			return new Response(
				`To test the scheduled handler, ensure you have used the "--test-scheduled" then try running "curl ${url.href}".`,
			);
		});

		r.all("/*", () => error(404, "Wrong Endpoint"));
		return r;
	}

	// TODO: should be dependency or we should move it somewhere
	newIndexer(env: Env): Indexer {
		const suiClient = new SuiClient({
			network: env.SUI_NETWORK,
			nbtcPkg: env.SUI_PACKAGE_ID,
			nbtcModule: NBTC_MODULE,
			nbtcObjectId: env.NBTC_OBJECT_ID,
			lightClientObjectId: env.LIGHT_CLIENT_OBJECT_ID,
			signerMnemonic: env.SUI_SIGNER_MNEMONIC,
		});
		return new Indexer(env, this.nbtcAddr, this.suiFallbackAddr, this.btcNetwork, suiClient);
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

	//
	// TODO: remove this
	//
	putTestKV = async (req: IRequest, env: Env) => {
		const kv = env.btc_blocks;
		const data = await req.json<{ key: string; val: string }>();
		if (!data.key || !data.val) return new Error("Wrong Request: body must by {key, val} JSON");

		console.log("recording to btc_blocks");
		await kv.put(data.key, data.val);
		const allKeys = await kv.list();
		return allKeys;
		// return 1;
	};
	getTestKV = async (req: IRequest, env: Env) => {
		const kv = env.btc_blocks;
		const key = req.params.key;
		return kv.get(key);
	};
}
