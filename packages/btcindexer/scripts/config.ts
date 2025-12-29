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
				nbtc_pkg: "0xddb6abfdb07259acac267d8e10db0bfa477f43c528356894c61ee0b8c0a77faf",
				nbtc_contract: "0xed6ab4f97ddec4a6b8181292dea85319fd10250f5f113d04c2c404b254f47526",
				lc_pkg: "0x808157392513cbc6034720c781b6d4360762a2a987ac4a4cc878c766272b1247",
				lc_contract: "0xfe02d9ec80523746fbd07e79fc15085295d06cbc140983ba4af1a3b9e00cdd50",
				sui_fallback_address:
					"0x529216e27401313e3513102f5706bafa9c5b44831867352ab111456dc1c5c4a7",
				btc_address: "bcrt1qkhsjfvnp0pnglhz6qywh6n8eqvr5ludsday0x2",
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
