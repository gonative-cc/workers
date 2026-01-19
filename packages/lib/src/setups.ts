import { isValidSuiNSName } from "@mysten/sui/utils";
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

const staging: Setup[] = [
	{
		id: 1,
		btc_network: BtcNet.REGTEST,
		sui_network: "testnet",
		// TODO: define remaining
	},
];

export const orgSetups: Record<string, Setup[]> = {
	staging,
};

function validateOrSetups() {
	// check ID Is unique and check we don't mix mainnet with testnet
}
