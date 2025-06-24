import type { IRequest, RouterType } from 'itty-router';

// list of argument types provided to the router handlers
export type CFArgs = [Env, ExecutionContext];

// itty router type for this worker
export type AppRouter = RouterType<IRequest, CFArgs>;

export default AppRouter;
