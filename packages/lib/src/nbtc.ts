export enum BtcNet {
	REGTEST = "regtest",
	TESTNET = "testnet",
	MAINNET = "mainnet",
	SIGNET = "signet",
}

export interface BlockQueueRecord {
	hash: string;
	height: number;
	network: BtcNet;
	timestamp_ms: number;
}

export function kvBlocksKey(network: string, blockHash: string): string {
	return `b:${network}:${blockHash}`;
}

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const btcElectrs: Record<BtcNet, string> = {
	regtest: "http://bitcoin-devnet.gonative.cc:3002",
	// NOTE: we need to set indexers for other networks
	testnet: "",
	mainnet: "",
	signet: "",
};

// returns Electrs URL for the given netowrk name.
// Throws exception if we don't have Electrs for the given network.
export function requireElectrsUrl(name: BtcNet): string {
	const net = btcElectrs[name];
	if (!net) throw Error("No electrs URL for Bitcoin " + name);
	return net;
}

// converts net to BtcNet by trimming and lowercasing.
// Throws exception if the network is invalid.
export function btcNetFromString(net: string): BtcNet {
	net = net.toLowerCase().trim();
	const validNets = Object.values(BtcNet) as string[];
	if (!validNets.includes(net)) throw new Error("Invalid BtcNet: " + net);

	return net as BtcNet;
}
