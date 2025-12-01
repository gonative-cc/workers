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
