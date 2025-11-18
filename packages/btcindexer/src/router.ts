import type { IRequest } from "itty-router";
import { Router, error, json } from "itty-router";
import { isValidSuiAddress } from "@mysten/sui/utils";

import { Indexer } from "./btcindexer";
import type { PostNbtcTxRequest } from "./models";
import { RestPath } from "./api/client";

import type { AppRouter, CFArgs } from "./routertype";
import { toSerializableError } from "./errutils";

export default class HttpRouter {
	#indexer?: Indexer;
	#router: AppRouter;

	constructor(indexer?: Indexer) {
		this.#indexer = indexer;
		this.#router = this.createRouter();
	}

	createRouter() {
		const r = Router<IRequest, CFArgs>({
			catch: error,
			// convert non `Response` objects to JSON Responses. If a handler returns `Response`
			// object then it will be directly returned.
			finally: [json],
		});
		// Bitcoin endpoints
		r.get(RestPath.latestHeight, this.getLatestHeight);

		r.post(RestPath.nbtcTx, this.postNbtcTx);
		// ?sui_recipient="0x..."  - query by sui address
		r.get(RestPath.nbtcTx, this.getNbtcMintTxsBySuiAddr);
		r.get(RestPath.nbtcTx + "/:txid", this.getNbtcMintTx); // query by bitcoin_tx_id
		r.get(RestPath.depositsBySender, this.getDepositsBySender);

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

	// we wrap the router.fetch method to provide the indexer to this object.
	// Otherwise we would need to setup the server on each fetch request.
	fetch = async (req: Request, env: Env, indexer: Indexer) => {
		this.#indexer = indexer;
		console.trace({ msg: "Incoming request", url: req.url, method: req.method });
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

	postNbtcTx = async (req: IRequest) => {
		const body: PostNbtcTxRequest = await req.json();

		if (!body || typeof body.txHex !== "string" || !body.network) {
			return error(
				400,
				"Request body must be a JSON object with 'txHex' and 'network' properties.",
			);
		}

		try {
			const result = await this.indexer().registerBroadcastedNbtcTx(body.txHex, body.network);
			return { success: true, ...result };
		} catch (e: unknown) {
			console.error({ msg: "Failed to register nBTC tx", error: toSerializableError(e) });
			const message = e instanceof Error ? e.message : "An unknown error occurred.";
			return new Response(message, { status: 400 });
		}
	};

	//
	// TODO: remove this
	//
	putTestKV = async (req: IRequest, env: Env) => {
		const kv = env.BtcBlocks;
		const data = await req.json<{ key: string; val: string }>();
		if (!data.key || !data.val) return new Error("Wrong Request: body must by {key, val} JSON");
		await kv.put(data.key, data.val);
		const allKeys = await kv.list();
		return allKeys;
		// return 1;
	};
	getTestKV = async (req: IRequest, env: Env) => {
		const kv = env.BtcBlocks;
		const params = req.params;
		if (!params) {
			return error(400, "Missing parameters");
		}
		const key = params.key;
		if (!key) {
			return error(400, "Missing key parameter");
		}
		return kv.get(key);
	};

	getNbtcMintTx = async (req: IRequest) => {
		const params = req.params;
		if (!params) {
			return error(400, "Missing parameters");
		}
		const { txid } = params;
		if (!txid) {
			return error(400, "Missing txid parameter");
		}
		const result = await this.indexer().getNbtcMintTx(txid);

		if (result === null) {
			return error(404, "Transaction not found.");
		}
		return result;
	};

	getNbtcMintTxsBySuiAddr = async (req: IRequest) => {
		const suiRecipient = req.query.sui_recipient;
		if (!suiRecipient || typeof suiRecipient !== "string") {
			return error(400, "Missing or invalid sui_recipient query parameter.");
		}
		if (!isValidSuiAddress(suiRecipient)) {
			return error(400, "Invalid SUI address format.");
		}
		return this.indexer().getNbtcMintTxsBySuiAddr(suiRecipient);
	};

	getLatestHeight = () => {
		return this.indexer().getLatestHeight();
	};

	getDepositsBySender = (req: IRequest) => {
		const sender = req.query.sender;
		if (!sender || typeof sender !== "string") {
			return error(400, "Missing or invalid sender query parameter.");
		}
		return this.indexer().getDepositsBySender(sender);
	};
}
