import { isValidSuiAddress, isValidSuiObjectId } from "@mysten/sui/utils";
import { BtcNet } from "./nbtc";
import type { SuiNet } from "./nsui";

export interface NbtcCfg {
	nbtc_pkg: string;
	nbtc_contract: string;
	sui_fallback_addr: string;
}

export interface BtcLCCfg {
	lc_pkg: string;
	lc_contract: string;
}

// This types uses only SQLite types and all structures form that types.
// NOTE: make sure this is in sync with the setups table!
export interface Setup extends NbtcCfg, BtcLCCfg {
	id: number;
	btc_network: BtcNet;
	sui_network: SuiNet;
	is_active: number; // TODO: rename to "active"
}

// for internal devnet
const dev: Setup[] = [
	{
		id: 1,
		btc_network: BtcNet.REGTEST,
		sui_network: "testnet",
		nbtc_pkg: "0x23b3ac95976e6ee755dcc9d2bbd0009dd526beb1778b146c499c872077662202",
		nbtc_contract: "0x8801c614fcf95339dfca4edf521b150ed1f63ec42b35816be11cb445bc9c057e",
		sui_fallback_addr: "0xce726adf013f79a029f73bb4baa56af644e90ef79ed0486c9550b76ee219f78e",
		lc_pkg: "0x9010405a2de729a8a2578ab78b061591dc6f637cca16fd17d84242fd6d485a6d",
		lc_contract: "0x74d82b7df244d578e6a71a57e84081e8a1050df5214e0f97870a8d9d486810a7",
	},
];

const staging: Setup[] = [
	{
		id: 2,
		btc_network: BtcNet.REGTEST,
		sui_network: "testnet",
		nbtc_pkg: "0x23b3ac95976e6ee755dcc9d2bbd0009dd526beb1778b146c499c872077662202",
		nbtc_contract: "0x8801c614fcf95339dfca4edf521b150ed1f63ec42b35816be11cb445bc9c057e",
		sui_fallback_addr: "0xce726adf013f79a029f73bb4baa56af644e90ef79ed0486c9550b76ee219f78e",
		lc_pkg: "0x9010405a2de729a8a2578ab78b061591dc6f637cca16fd17d84242fd6d485a6d",
		lc_contract: "0x74d82b7df244d578e6a71a57e84081e8a1050df5214e0f97870a8d9d486810a7",
	},
];

export const orgSetups: Record<string, Setup[]> = {
	dev,
	staging,
};

// checks:
// - every id is unique
// - all contracts and pkgs are valid sui addresses
export function validateAllSetups(setupMaps: Record<string, Setup[]>): Error | null {
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
