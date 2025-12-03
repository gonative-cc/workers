import { test, expect } from "bun:test";

import * as nbtc from "./nbtc";

test("btcNetFromString", () => {
	expect(nbtc.btcNetFromString("testnet")).toBe(nbtc.BtcNet.TESTNET);
	expect(nbtc.btcNetFromString(" Signet   ")).toBe(nbtc.BtcNet.SIGNET);

	expect(() => nbtc.btcNetFromString("other")).toThrowError("Invalid BtcNet");
});
