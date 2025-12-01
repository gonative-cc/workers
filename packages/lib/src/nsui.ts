export type SuiNet = "testnet" | "mainnet" | "devnet" | "localnet";

export interface NbtcPkg {
	nbtcPkg: string;
	suiNetwork: SuiNet;
}

export interface NbtcCfg {
	network: SuiNet;
	nbtcPkg: string;
	nbtcModule: string;
}
