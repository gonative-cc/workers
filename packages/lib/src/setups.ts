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
	ika_pkg: string; // Ika coordinator pkg
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
		ika_pkg: "0x4d157b7415a298c56ec2cb1dcab449525fa74aec17ddba376a83a7600f2062fc",
		is_active: 1,
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
		ika_pkg: "0x4d157b7415a298c56ec2cb1dcab449525fa74aec17ddba376a83a7600f2062fc",
		is_active: 1,
	},
];

export const TestEnvName = "TestEnv";
export const TestEnv: Setup[] = [
	{
		id: -1,
		btc_network: BtcNet.REGTEST,
		sui_network: "devnet",
		nbtc_pkg: "0xPkg1",
		nbtc_contract: "0xContract1",
		sui_fallback_addr: "0xFallback1",
		lc_pkg: "0xLC1",
		lc_contract: "0xLCC1",
		ika_pkg: "0xika",
		is_active: 1,
	},
	{
		id: -2,
		btc_network: BtcNet.TESTNET,
		sui_network: "testnet",
		nbtc_pkg: "0xPkg2",
		nbtc_contract: "0xContract2",
		sui_fallback_addr: "0xFallback2",
		lc_pkg: "0xLC1",
		lc_contract: "0xLCC1",
		ika_pkg: "0xika",
		is_active: 1,
	},
];

export const setupEnvs: Record<string, Setup[]> = {
	TestEnv,
	dev,
	staging,
};

const setupsById: Record<string, Setup> = {};
for (const [_envName, setups] of Object.entries(setupEnvs)) {
	for (const s of setups) {
		setupsById[s.id] = s;
	}
}

export function getSetup(id: number): Setup | undefined {
	return setupsById[id];
}

export function getActiveSetups(envName: string): Setup[] {
	const activeSetups = [];
	for (const s of setupEnvs[envName] || []) {
		if (s.is_active) activeSetups.push(s);
	}

	return activeSetups;
}
