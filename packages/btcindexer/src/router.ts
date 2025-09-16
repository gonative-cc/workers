import { IRequest, Router, error, json } from "itty-router";
import { isValidSuiAddress } from "@mysten/sui/utils";

import { Indexer } from "./btcindexer";
import { RestPath } from "./api/client";
import { PostNbtcTxRequest } from "./models";

import type { AppRouter, CFArgs } from "./routertype";
import { PutBlocksReq } from "./api/put-blocks";

export default class HttpRouter {
	#indexer?: Indexer;
	#router: AppRouter;

	constructor(indexer?: Indexer) {
		this.#indexer = indexer;
		this.#router = this.createRouter();
	}

	private authMiddleware = (req: IRequest, env: Env) => {
		if (!env.BEARER_TOKEN || env.BEARER_TOKEN.trim() === "") {
			return;
		}

		const authorization = req.headers.get("Authorization");
		if (!authorization) {
			return error(401, "Authorization header is required");
		}

		const [scheme, token] = authorization.split(" ");
		if (scheme !== "Bearer" || !token) {
			return error(401, "Invalid authorization format. Expected: Bearer <token>");
		}

		if (token !== env.BEARER_TOKEN) {
			return error(401, "Invalid bearer token");
		}

		return;
	};

	createRouter() {
		const r = Router<IRequest, CFArgs>({
			catch: error,
			// convert non `Response` objects to JSON Responses. If a handler returns `Response`
			// object then it will be directly returned.
			finally: [json],
		});
		// Bitcoin endpoints
		r.put(RestPath.blocks, this.authMiddleware, this.putBlocks);
		r.get(RestPath.latestHeight, this.getLatestHeight);

		r.post(RestPath.nbtcTx, this.authMiddleware, this.postNbtcTx);
		// ?sui_recipient="0x..."  - query by sui address
		r.get(RestPath.nbtcTx, this.getStatusBySuiAddress);
		r.get(RestPath.nbtcTx + "/:txid", this.getStatusByTxid); // query by bitcoin_tx_id

		//
		// TESTING
		// we can return Response object directly, to avoid JSON serialization
		r.get("/test/user/:id", (req) => new Response(`User ID: ${req.params.id}`));
		// curl http://localhost:8787/test/kv/ -X PUT -d '{"key": "k102", "val": "v1"}'
		r.put("/test/kv", this.authMiddleware, this.putTestKV);
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

	// we wrap the router.fetch method to provide the indexer to this object.
	// Otherwise we would need to setup the server on each fetch request.
	fetch = async (req: Request, env: Env, indexer: Indexer) => {
		this.#indexer = indexer;
		return this.#router.fetch(req, env);
	};

	indexer(): Indexer {
		if (this.#indexer === undefined) {
			throw new Error("Indexer is not initialized");
		}
		return this.#indexer;
	}

	// NOTE: for handlers we user arrow function to avoid `bind` calls when using class methods
	// in callbacks.

	// NOTE: we may need to put this to a separate worker
	putBlocks = async (req: IRequest) => {
		try {
			const blocks = PutBlocksReq.decode(await req.arrayBuffer());
			return { inserted: await this.indexer().putBlocks(blocks) };
		} catch (e) {
			console.error("DEBUG: FAILED TO DECODE REQUEST BODY");
			console.error(e);
			return new Response("Failed to decode msgpack body. Check wrangler logs for details.", {
				status: 400,
			});
		}
	};

	postNbtcTx = async (req: IRequest) => {
		const body: PostNbtcTxRequest = await req.json();

		if (!body || typeof body.txHex !== "string") {
			return error(400, "Request body must be a JSON object with a 'txHex' property.");
		}

		try {
			const result = await this.indexer().registerBroadcastedNbtcTx(body.txHex);
			return { success: true, ...result };
		} catch (e: unknown) {
			console.error("Failed to register nBTC tx:", e);
			const message = e instanceof Error ? e.message : "An unknown error occurred.";
			return error(400, message);
		}
	};

	//
	// TODO: remove this
	//
	putTestKV = async (req: IRequest, env: Env) => {
		const kv = env.btc_blocks;
		const data = await req.json<{ key: string; val: string }>();
		if (!data.key || !data.val) return new Error("Wrong Request: body must by {key, val} JSON");
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

	getStatusByTxid = async (req: IRequest) => {
		const { txid } = req.params;
		const result = await this.indexer().getStatusByTxid(txid);

		if (result === null) {
			return error(404, "Transaction not found.");
		}
		return result;
	};

	getStatusBySuiAddress = async (req: IRequest) => {
		const suiRecipient = req.query.sui_recipient;
		if (!suiRecipient || typeof suiRecipient !== "string") {
			return error(400, "Missing or invalid sui_recipient query parameter.");
		}
		if (!isValidSuiAddress(suiRecipient)) {
			return error(400, "Invalid SUI address format.");
		}
		return this.indexer().getStatusBySuiAddress(suiRecipient);
	};

	getLatestHeight = () => {
		return this.indexer().getLatestHeight();
	};
}
