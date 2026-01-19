import { test, expect } from "bun:test";
import { orgSetups, validateAllSetups } from "./setups";

test("orgSetups", () => {
	expect(validateAllSetups(orgSetups)).toBeNull();
});
