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
	kv_key: string;
}

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
