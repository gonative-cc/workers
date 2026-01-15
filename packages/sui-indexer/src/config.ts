import type { SuiNet } from "@gonative-cc/lib/nsui";

export const SUI_NETWORK_URLS: Record<SuiNet, string> = {
	mainnet: "https://graphql.mainnet.sui.io/graphql",
	testnet: "https://graphql.testnet.sui.io/graphql",
	devnet: "https://graphql.devnet.sui.io/graphql",
	localnet: "TODO",
};
