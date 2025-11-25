import type { SuiNet } from "@gonative-cc/lib/nsui";

export const SUI_NETWORK_URLS: Record<SuiNet, string> = {
	mainnet: "https://sui-mainnet.mystenlabs.com/graphql",
	testnet: "https://sui-testnet.mystenlabs.com/graphql",
	devnet: "https://sui-devnet.mystenlabs.com/graphql",
	localnet: "TODO",
};
