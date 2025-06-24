import { Router, error, json } from 'itty-router';
import type { CFArgs } from './routertype';
import type { IRequest } from 'itty-router';
import addExampleRoutes from './examples';
import { HIndexer } from './btcindexer-http';

const router = Router<IRequest, CFArgs>({
	// const router = AppRouter({
	catch: error,
	// convert non Response objects to JSON Responses
	finally: [json],
});

addExampleRoutes(router);

const btcIndexer = new HIndexer();
router.put('/bitcoin/blocks', btcIndexer.putBlocks.bind({}));
router.put('/nbtc', btcIndexer.putNbtcTx.bind({}));

router.all('/*', () => error(404, "Wrong Endpoint"));

export default router;
