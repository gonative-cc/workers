import { BitcoinNetwork } from "./networks";

export interface BlockQueueMessage {
	hash: string;
	height: number;
	network: BitcoinNetwork;
	kv_key: string;
}
