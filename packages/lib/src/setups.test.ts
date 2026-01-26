import { test, expect } from "bun:test";
import { isValidSuiAddress, isValidSuiObjectId } from "@mysten/sui/utils";

import { type Setup, setupEnvs } from "./setups";

// checks:
// - every id is unique
// - all contracts and pkgs are valid sui addresses
function validateAllSetups(setupMaps: Record<string, Setup[]>): Error | null {
	const ids = new Set();
	const errs: string[] = [];
	for (const [_envName, setups] of Object.entries(setupMaps)) {
		for (const s of setups) {
			if (ids.has(s.id)) errs.push(`Setup id=${s.id} is not unique`);
			else ids.add(s.id);

			if (!isValidSuiObjectId(s.nbtc_contract))
				errs.push(`Setup=${s.id} has invalid nbtc_contract`);
			if (!isValidSuiObjectId(s.lc_contract))
				errs.push(`Setup=${s.id} has invalid lc_contract`);
			if (!isValidSuiAddress(s.nbtc_pkg)) errs.push(`Setup=${s.id} has invalid nbtc_pkg`);
			if (!isValidSuiAddress(s.lc_pkg)) errs.push(`Setup=${s.id} has invalid lc_pkg`);
		}
	}
	if (errs.length > 0) {
		return new Error(JSON.stringify(errs));
	}
	return null;
}

test("orgSetups", () => {
	expect(validateAllSetups(setupEnvs)).toBeNull();
});
