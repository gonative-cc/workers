import { Router } from "itty-router";
import { PutBlocksReq } from "./api/put-blocks";
import { isAuthorized } from "./auth";
import { handleIngestBlocks } from "./ingest";
import { type BtcIndexerRpc } from "@gonative-cc/btcindexer/rpc-interface";
import { logError } from "@gonative-cc/lib/logger";
import { btcNetFromString } from "@gonative-cc/lib/nbtc";

export const router = Router();

router.put("/bitcoin/blocks", async (request, env: Env) => {
	if (!(await isAuthorized(request, env))) {
		return new Response("Unauthorized", { status: 401 });
	}

	try {
		const blocks = PutBlocksReq.decode(await request.arrayBuffer());
		await handleIngestBlocks(blocks, env.BtcBlocks, env.BlockQueue);
		return new Response("Blocks ingested successfully", { status: 200 });
	} catch (e) {
		logError({ msg: "Failed to ingest blocks", method: "PUT /bitcoin/blocks" }, e);
		const message = e instanceof Error ? e.message : "Failed to process request";
		return new Response(message, { status: 500 });
	}
});

router.get("/bitcoin/latest-height", async (request, env: Env) => {
	const url = new URL(request.url);
	const network = url.searchParams.get("network");
	if (!network) {
		return new Response("Missing network parameter", { status: 400 });
	}

	try {
		const btcNet = btcNetFromString(network);
		const btcindexer = envBtcIndexer(env);
		const result = await btcindexer.latestHeight(btcNet);
		return Response.json(result);
	} catch (e) {
		logError({ msg: "Failed to get latest height", method: "GET /bitcoin/latest-height" }, e);
		return new Response("Internal Error", { status: 500 });
	}
});

router.all("*", () => new Response("Not Found", { status: 404 }));

function envBtcIndexer(env: Env): BtcIndexerRpc {
	return env.BtcIndexer as unknown as BtcIndexerRpc;
}

export default {
	async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
		return router.handle(request, env);
	},
};
