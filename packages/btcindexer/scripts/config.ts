export interface SetupCfg {
	btc_network: string;
	sui_network: string;
	nbtc_pkg: string;
	nbtc_contract: string;
	lc_pkg: string;
	lc_contract: string;
	sui_fallback_address: string;
	btc_address: string;
}

export type EnvName = "prod" | "backstage" | "dev";

interface Config {
	db_name: string;
	setups: SetupCfg[];
}

export const SETUPS: Record<EnvName, Config> = {
	dev: {
		db_name: "btcindexer-dev",
		setups: [
			// testnet-v3.0
			{
				btc_network: "regtest",
				sui_network: "testnet",
				nbtc_pkg: "0xbbee5a5d833847125ab6c029d5ffec29c5f979cfcdf1906e98918eb86eb84e46",
				nbtc_contract: "0x9a0d5f810a8880fa69db46ce0b09bcb101f27fb3865adf365c33e2051d48f38a",
				lc_pkg: "0x106eb827fbdbfb30c7d35959acee8fdfee3a7bb80e8f85ca984d5db8c22f2114",
				lc_contract: "0xed0877a279110aab81c99f7956e3db5e7549f4c5b0f6cf163a51a5a2f9d5afa3",
				sui_fallback_address:
					"0x0c62bfbe82105cd8b783ae9d5b8b582b2b579fa86d3089acd7cbeb763e367867",
				btc_address: "bcrt1q2vawj829uru8zynh284s43cd5d4kn5j4n0098p",
			},
			// in order to add more addresses to the same package, add another entry with the same package config
		],
	},
	backstage: {
		db_name: "btcindexer-backstage",
		setups: [],
	},
	prod: {
		db_name: "btcindexer-prod",
		setups: [],
	},
};
