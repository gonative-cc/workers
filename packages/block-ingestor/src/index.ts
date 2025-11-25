import { PutBlocksReq } from "./api/put-blocks";
import { handleIngestBlocks } from "./ingest";

export default {
	async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
		// TODO: add authentication method here
		const url = new URL(request.url);
		if (request.method === "PUT" && url.pathname === "/bitcoin/blocks") {
			try {
				const blocks = PutBlocksReq.decode(await request.arrayBuffer());
				await handleIngestBlocks(blocks, env.BtcBlocks, env.BlockQueue);
				return new Response("Blocks ingested successfully", { status: 200 });
			} catch (e) {
				console.error("Failed to ingest blocks", e);
				const message = e instanceof Error ? e.message : "Failed to process request";
				return new Response(message, { status: 500 });
			}
		}
		if (request.method === "GET" && url.pathname === "/bitcoin/latest-height") {
			try {
				const result = await env.BtcIndexer.latestHeight();
				return Response.json(result);
			} catch (e) {
				console.error("Failed to get latest height via RPC", e);
				return new Response("Internal Error", { status: 500 });
			}
		}
		return new Response("Not Found", { status: 404 });
	},
};
