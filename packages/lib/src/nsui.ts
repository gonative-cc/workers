export type SuiNet = "testnet" | "mainnet" | "devnet" | "localnet";

export interface NbtcCfg {
	network: SuiNet;
	nbtcPkg: string;
	nbtcModule: string;
}
