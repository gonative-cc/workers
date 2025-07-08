import { expect, test } from "vitest";

import { Indexer } from "./btcindexer";

test("nbtc add tx", async () => {
	const i = new Indexer({} as Env, "todo");
	expect(await i.putNbtcTx()).toBe(true);
});
