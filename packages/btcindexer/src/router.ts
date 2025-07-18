import { Router, error, json } from "itty-router";
import type { CFArgs } from "./routertype";
import type { IRequest } from "itty-router";
import addExampleRoutes from "./examples";
import { HIndexer } from "./btcindexer-http";

const router = Router<IRequest, CFArgs>({
	catch: error,
	// convert non `Response` objects to JSON Responses. If a handler returns `Response` object then it will
	// be directly returned.
	finally: [json],
});

addExampleRoutes(router);

const btcIndexer = new HIndexer();
router.put("/bitcoin/blocks", btcIndexer.putBlocks);
router.put("/nbtc", btcIndexer.putNbtcTx);

// TESTING
router.put("/test-kv", btcIndexer.putTestKV);

router.all("/*", () => error(404, "Wrong Endpoint"));

export default router;
