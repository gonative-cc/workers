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
import { SuiClientImp, type SuiClient } from "./sui_client";
import type { SuiNet } from "@gonative-cc/lib/nsui";

export default {
	async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
		console.log("Running scheduled redeem solver task...");
		const mnemonic = (await env.NBTC_MINTING_SIGNER_MNEMONIC.get()) || "";
		if (!mnemonic) {
			console.error("Missing NBTC_MINTING_SIGNER_MNEMONIC");
			return;
		}
		const storage = new D1Storage(env.DB);

		const activeNetworks = await storage.getActiveNetworks();
		const clients = new Map<SuiNet, SuiClient>();

		for (const net of activeNetworks) {
			clients.set(
				net,
				new SuiClientImp({
					network: net,
					signerMnemonic: mnemonic,
				}),
			);
		}

		const service = new RedeemService(storage, clients);

		await service.processPendingRedeems();
	},
} satisfies ExportedHandler<Env>;

export { RPC };
