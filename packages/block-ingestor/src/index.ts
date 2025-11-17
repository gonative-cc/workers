import { PutBlocksReq } from "./api/put-blocks";
import { handleIngestBlocks } from "./ingest";
import { BitcoinNetwork } from "@gonative-cc/lib/bitcoin";

export default {
	async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
		// TODO: add authentication method here
		if (request.method !== "POST") {
			return new Response("Method Not Allowed", { status: 405 });
		}

		try {
			const blocks = PutBlocksReq.decode(await request.arrayBuffer());
			await handleIngestBlocks(blocks, env.BlockStore, env.BlockQueue);
			return new Response("Blocks ingested successfully", { status: 200 });
		} catch (e) {
			console.error("Failed to ingest blocks", e);
			const message = e instanceof Error ? e.message : "Failed to process request";
			return new Response(message, { status: 500 });
		}
	},
};
