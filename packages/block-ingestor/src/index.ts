import { Router } from "itty-router";
import { PutBlocksReq } from "./api/put-blocks";
import { handleIngestBlocks } from "./ingest";
import type { BtcIndexerRpcI } from "../../btcindexer/src/rpc-interface";
import { WorkerEntrypoint } from "cloudflare:workers";

interface Env {
	BtcBlocks: KVNamespace;
	BlockQueue: Queue;
	BtcIndexer: Service<BtcIndexerRpcI & WorkerEntrypoint<Env>>;
	ENVIRONMENT: string;
}

const router = Router();

router.put("/bitcoin/blocks", async (request, env: Env) => {
	try {
		const blocks = PutBlocksReq.decode(await request.arrayBuffer());
		await handleIngestBlocks(blocks, env.BtcBlocks, env.BlockQueue);
		return new Response("Blocks ingested successfully", { status: 200 });
	} catch (e) {
		console.error("Failed to ingest blocks", e);
		const message = e instanceof Error ? e.message : "Failed to process request";
		return new Response(message, { status: 500 });
	}
});

router.get("/bitcoin/latest-height", async (_request, env: Env) => {
	try {
		const result = await env.BtcIndexer.latestHeight();
		return Response.json(result);
	} catch (e) {
		console.error("Failed to get latest height via RPC", e);
		return new Response("Internal Error", { status: 500 });
	}
});

router.all("*", () => new Response("Not Found", { status: 404 }));

export default {
	async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
		// TODO: add authentication method here
		return router.handle(request, env);
	},
};
