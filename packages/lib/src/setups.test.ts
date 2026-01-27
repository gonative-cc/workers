import { test, expect } from "bun:test";
import { isValidSuiAddress, isValidSuiObjectId } from "@mysten/sui/utils";

import { type Setup, setupEnvs } from "./setups";

function validateAllSetups(setupMaps: Record<string, Setup[]>): Error | null {
	const ids = new Set();
	const errs: string[] = [];
	for (const [_envName, setups] of Object.entries(setupMaps)) {
		const uniqueNbtc = new Set<string>();
		for (const s of setups) {
			// CHECK: every setup_id is unique
			if (ids.has(s.id)) errs.push(`Setup id=${s.id} is not unique`);
			else ids.add(s.id);

			// CHECK: all contracts and pkgs are valid sui addresses
			if (!isValidSuiObjectId(s.nbtc_contract))
				errs.push(`Setup=${s.id} has invalid nbtc_contract`);
			if (!isValidSuiObjectId(s.lc_contract))
				errs.push(`Setup=${s.id} has invalid lc_contract`);
			if (!isValidSuiAddress(s.nbtc_pkg)) errs.push(`Setup=${s.id} has invalid nbtc_pkg`);
			if (!isValidSuiAddress(s.lc_pkg)) errs.push(`Setup=${s.id} has invalid lc_pkg`);

			// - in given env, the pair (sui_network, nbtc_pkg) and (btc_network, nbtc_pkg) of active setups are unique
			//   NOTE: this assumption is used in the sui-indexer storage implementation
			if (s.is_active) {
				const suiKey = "sui++" + s.sui_network + "++" + s.nbtc_pkg;
				const btcKey = "btc++" + s.btc_network + "++" + s.nbtc_pkg;
				if (uniqueNbtc.has(suiKey)) errs.push(`Setup=${s.id} has not unique Sui+nbtc`);
				else uniqueNbtc.add(suiKey);
				if (uniqueNbtc.has(btcKey)) errs.push(`Setup=${s.id} has not unique Btc+nbtc`);
				else uniqueNbtc.add(btcKey);
			}
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
