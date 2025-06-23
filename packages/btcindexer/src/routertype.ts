import type { IRequest, RouterType } from 'itty-router';

type Environment = {
	KV: KVNamespace;
};

export type CFArgs = [Environment, ExecutionContext];

export type AppRouter = RouterType<IRequest, CFArgs>;

export default AppRouter;
