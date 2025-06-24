import type { IRequest, RouterType } from 'itty-router';

// Cloudflare env object
type Environment = {
	KV: KVNamespace;
};

// list of argument types provided to the router handlers
export type CFArgs = [Environment, ExecutionContext];

// itty router type for this worker
export type AppRouter = RouterType<IRequest, CFArgs>;

export default AppRouter;
