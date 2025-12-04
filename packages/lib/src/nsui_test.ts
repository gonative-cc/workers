import { test, expect } from "bun:test";

import * as nsui from "./nsui";

test("toSuiNet", () => {
	expect(nsui.toSuiNet("testnet")).toBe("testnet");
	expect(nsui.toSuiNet("mainnet")).toBe("mainnet");

	expect(() => nsui.toSuiNet("other")).toThrowError("Invalid SuiNet");
	expect(() => nsui.toSuiNet("Mainnet")).toThrowError("Invalid SuiNet");
});
