export enum BtcNet {
	REGTEST = "regtest",
	TESTNET = "testnet",
	MAINNET = "mainnet",
	SIGNET = "signet",
}

export interface BlockQueueMessage {
	hash: string;
	height: number;
	network: BtcNet;
	kv_key: string;
}
