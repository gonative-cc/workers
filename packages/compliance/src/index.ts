import { D1Storage } from "./storage";

// Export RPC entrypoints for service bindings
export { RPC } from "./rpc";

export default {
	async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
		// TODO: run DB updates
		const storage = new D1Storage(env.DB);
	},
} satisfies ExportedHandler<Env>;
