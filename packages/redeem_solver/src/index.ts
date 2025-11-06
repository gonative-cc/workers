/**
 * HTTP + Scheduled Worker: a Worker that can run on a
 * configurable interval and has HTTP server:
 * https://developers.cloudflare.com/workers/platform/triggers/cron-triggers/
 *
 * Bind resources to your Worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `bun run typegen`.
 */

import { RPC } from "./rpc";

export default {
	// TODO: probably we don't need it and we can remove the fetch / HTTP API and only use RPC
	async fetch(_req: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
		return new Response();
	},
} satisfies ExportedHandler<Env>;

// Export the RPC entrypoint for service bindings
export { RPC };
