export enum BitcoinNetwork {
	REGTEST = "regtest",
	TESTNET = "testnet",
	MAINNET = "mainnet",
	SIGNET = "signet",
}

export interface BlockQueueMessage {
	hash: string;
	height: number;
	network: BitcoinNetwork;
	kv_key: string;
}
