export type SuiNet = "testnet" | "mainnet" | "devnet" | "localnet";

// TODO: should use setup_id instead of this object
export interface NbtcPkg {
	nbtcPkg: string;
	suiNetwork: SuiNet;
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
