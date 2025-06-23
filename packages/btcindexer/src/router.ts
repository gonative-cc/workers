import { Router, error, json } from 'itty-router';
import type { CFArgs } from './routertype';
import type { IRequest } from 'itty-router';
import addExampleRoutes from './examples';

const router = Router<IRequest, CFArgs>({
	// const router = AppRouter({
	catch: error,
	// convert non Response objects to JSON Responses
	finally: [json],
});

addExampleRoutes(router);

export default router;
