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
import { createSuiClients } from "./sui_client";
import { logger, logError } from "@gonative-cc/lib/logger";

export default {
	async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
		logger.info({ msg: "Running scheduled redeem solver task..." });
		let mnemonic: string;
		try {
			mnemonic = (await env.NBTC_MINTING_SIGNER_MNEMONIC.get()) || "";
		} catch (error) {
			logger.error({ msg: "Failed to retrieve NBTC_MINTING_SIGNER_MNEMONIC", error });
			return;
		}
		if (!mnemonic) {
			logger.error({ msg: "Missing NBTC_MINTING_SIGNER_MNEMONIC" });
			return;
		}
		const storage = new D1Storage(env.DB);
		const activeNetworks = await storage.getActiveNetworks();
		const clients = await createSuiClients(activeNetworks, mnemonic);
		const service = new RedeemService(
			storage,
			clients,
			env.UTXO_LOCK_TIME,
			env.REDEEM_DURATION_MS,
		);

		const results = await Promise.allSettled([
			service.processPendingRedeems(), // propose a solution
			service
				.solveReadyRedeems() // trigger status change
				.then(service.processSolvedRedeems), // request signatures
		]);

		// Check for any rejected promises and log errors
		results.forEach((result, index) => {
			if (result.status === "rejected") {
				logError(
					{
						msg: "Processing redeems error",
						method: "redeem-solver scheduler",
						task:
							index === 0
								? "processPendingRedeems"
								: "solveReadyRedeems/processSolvedRedeems",
					},
					result.reason,
				);
			}
		});
	},
} satisfies ExportedHandler<Env>;

export { RPC };
