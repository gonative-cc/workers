import type { SuiNet } from "@gonative-cc/lib/nsui";

export const SUI_NETWORK_URLS: Record<SuiNet, string> = {
	mainnet: "https://graphql.mainnet.sui.io/graphql",
	testnet: "https://graphql.testnet.sui.io/graphql",
	devnet: "https://graphql.devnet.sui.io/graphql",
	localnet: "TODO",
};

// TODO: temporary config - Remove this config when deploying to production.
// Instead we should populate the coordinator_pkg column in the setups table via migration:
// UPDATE setups SET coordinator_pkg = '0x6573a6c13daf26a64eb8a37d3c7a4391b353031e223072ca45b1ff9366f59293' WHERE sui_network = 'testnet';
// UPDATE setups SET coordinator_pkg = '0x23b5bd96051923f800c3a2150aacdcdd8d39e1df2dce4dac69a00d2d8c7f7e77' WHERE sui_network = 'mainnet';
export const IKA_COORDINATOR_PACKAGES: Partial<Record<SuiNet, string>> = {
	testnet: "0x6573a6c13daf26a64eb8a37d3c7a4391b353031e223072ca45b1ff9366f59293",
	mainnet: "0x23b5bd96051923f800c3a2150aacdcdd8d39e1df2dce4dac69a00d2d8c7f7e77",
};
