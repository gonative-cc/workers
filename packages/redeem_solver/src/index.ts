/**
 * HTTP + Scheduled Worker: a Worker that can run on a
 * configurable interval and has HTTP server:
 * https://developers.cloudflare.com/workers/platform/triggers/cron-triggers/
 *
 * Bind resources to your Worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `bun run typegen`.
 */
import { RPC } from "./rpc";
import { D1Storage } from "./storage";
import { RedeemService } from "./service";

export default {
	async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
		console.log("Running scheduled redeem solver task...");
		const mnemonic = (await env.NBTC_MINTING_SIGNER_MNEMONIC.get()) || "";
		if (!mnemonic) {
			console.error("Missing NBTC_MNEMONIC");
			return;
		}
		const storage = new D1Storage(env.DB);
		const service = new RedeemService(storage, mnemonic);

		await service.processPendingRedeems();
	},
} satisfies ExportedHandler<Env>;

export { RPC };
