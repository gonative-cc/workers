import { BitcoinNetwork } from "@gonative-cc/lib/bitcoin";
import type { NbtcTxResp } from "./models";

export interface PutNbtcTxResponse {
	tx_id: string;
	registered_deposits: number;
}

/**
 * Interface defining the BtcIndexer RPC functions.
 */
export interface BtcIndexerRpcI {
	latestHeight(): Promise<{ height: number | null }>;
	putNbtcTx(txHex: string, network: BitcoinNetwork): Promise<PutNbtcTxResponse>;
	statusByTxid(txid: string): Promise<NbtcTxResp | null>;
	statusBySuiAddress(suiAddress: string): Promise<NbtcTxResp[]>;
	depositsBySender(address: string): Promise<NbtcTxResp[]>;
}
