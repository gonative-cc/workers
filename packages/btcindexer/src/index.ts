/**
 * HTTP + Scheduled Worker: a Worker that can run on a
 * configurable interval and has HTTP server:
 * https://developers.cloudflare.com/workers/platform/triggers/cron-triggers/
 *
 * Bind resources to your Worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `pnpm run typegen`.
 */

import router from "./router";

export default {
	fetch: router.fetch,

	// The scheduled handler is invoked at the interval set in our wrangler.jsonc's
	// [[triggers]] configuration.
	async scheduled(event /*, env, ctx*/): Promise<void> {
		// A Cron Trigger can make requests to other endpoints on the Internet,
		// publish to a Queue, query a D1 Database, and much more.
		// You could store this result in KV, write to a D1 Database, or publish to a Queue.
		// In this template, we'll just log the result:
		console.log(`trigger fired at ${event.cron}`);
	},
} satisfies ExportedHandler<Env>;
