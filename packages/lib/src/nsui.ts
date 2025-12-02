export type SuiNet = "testnet" | "mainnet" | "devnet" | "localnet";

export const SUI_GRAPHQL_URLS: Record<SuiNet, string> = {
	mainnet: "https://graphql.mainnet.sui.io/graphql",
	testnet: "https://graphql.testnet.sui.io/graphql",
	devnet: "https://graphql.devnet.sui.io/graphql",
	localnet: "TODO",
};

export interface NbtcPkg {
	nbtcPkg: string;
	suiNetwork: SuiNet;
}

export interface NbtcCfg {
	network: SuiNet;
	nbtcPkg: string;
	nbtcModule: string;
}
