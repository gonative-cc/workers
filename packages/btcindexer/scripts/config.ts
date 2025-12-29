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
				nbtc_pkg: "0xf30c0504bc24ffc4983669b931dbe869288da7a8afb88d8181cb307eda8b73cd",
				nbtc_contract: "0x05661455295929e36d6419fba5b941f859a27e83eb4eebffa7a12e09022303b4",
				lc_pkg: "0x808157392513cbc6034720c781b6d4360762a2a987ac4a4cc878c766272b1247",
				lc_contract: "0xfe02d9ec80523746fbd07e79fc15085295d06cbc140983ba4af1a3b9e00cdd50",
				sui_fallback_address:
					"0x529216e27401313e3513102f5706bafa9c5b44831867352ab111456dc1c5c4a7",
				btc_address: "bcrt1qtnz03pfehxlz3xma8xhumqjk3es8c4ld5v6ggs",
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
