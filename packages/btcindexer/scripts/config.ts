export interface NbtcPackageConfig {
	btc_network: string;
	sui_network: string;
	nbtc_pkg: string;
	nbtc_contract: string;
	lc_pkg: string;
	lc_contract: string;
	sui_fallback_address: string;
	btc_address: string;
}

export const NBTC_PACKAGES: NbtcPackageConfig[] = [
	{
		btc_network: "regtest",
		sui_network: "devnet",
		nbtc_pkg: "TODO",
		nbtc_contract: "TODO",
		lc_pkg: "TODO",
		lc_contract: "TODO",
		sui_fallback_address: "TODO",
		btc_address: "TODO",
	},
	// in order to add more addresses to the same package, add another entry with the same package config
];
