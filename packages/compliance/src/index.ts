import { logger, logError } from "@gonative-cc/lib/logger";
import { updateSanctionedAddress } from "./sanction";

// Export RPC entrypoints for service bindings
export { RPC } from "./rpc";

export default {
	async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
		logger.debug({ msg: "Cron job starting" });
		try {
			await updateSanctionedAddress(env.DB);
			logger.info({ msg: "Cron job finished successfully" });
		} catch (e) {
			logError({ msg: "Cron job failed", method: "scheduled" }, e);
		}
	},
} satisfies ExportedHandler<Env>;
