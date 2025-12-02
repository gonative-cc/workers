export type SuiNet = "testnet" | "mainnet" | "devnet" | "localnet";

export const SUI_GRAPHQL_URLS: Record<SuiNet, string> = {
	mainnet: "https://sui-mainnet.mystenlabs.com/graphql",
	testnet: "https://sui-testnet.mystenlabs.com/graphql",
	devnet: "https://sui-devnet.mystenlabs.com/graphql",
	localnet: "http://localhost:9125/graphql",
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
