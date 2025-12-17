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

const validNets = Object.values(BtcNet) as string[];

// converts net to BtcNet by trimming and lowercasing.
// Throws exception if the network is invalid.
export function btcNetFromString(net: string): BtcNet {
	net = net.toLowerCase().trim();
	if (!validNets.includes(net)) throw new Error("Invalid BtcNet: " + net);

	return net as BtcNet;
}

/**
 * Calculates the number of confirmations for a transaction in a block.
 * @param txBlockHeight - The height of the block containing the transaction.
 * @param chainTipHeight - The current height of the blockchain tip.
 * @returns The number of confirmations (0 if unconfirmed or invalid).
 */
export function calculateConfirmations(
	txBlockHeight: number | null | undefined,
	chainTipHeight: number | null | undefined,
): number {
	if (txBlockHeight == null || chainTipHeight == null) {
		return 0;
	}
	const confs = chainTipHeight - txBlockHeight + 1;
	return confs > 0 ? confs : 0;
}
