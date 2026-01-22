import { test, expect } from "bun:test";
import { setupEnvs, validateAllSetups } from "./setups";

test("orgSetups", () => {
	expect(validateAllSetups(setupEnvs)).toBeNull();
});
