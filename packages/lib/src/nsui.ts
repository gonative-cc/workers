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

/**
 * Validates and converts a string to the SuiNet type.
 * @throws {Error} If the string is not a valid SuiNet value.
 */
export function toSuiNet(value: string): SuiNet {
	switch (value) {
		case "testnet":
		case "mainnet":
		case "devnet":
		case "localnet":
			return value;
		default:
			throw new Error("Invalid SuiNet");
	}
}
