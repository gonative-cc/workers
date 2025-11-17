import { BitcoinNetwork } from "@gonative-cc/lib/bitcoin";
import type { TxStatusResp } from "./models";

export interface PutNbtcTxResponse {
	tx_id: string;
	registered_deposits: number;
}

/**
 * Interface defining the BtcIndexer RPC functions.
 */
export interface InterfaceBtcIndexerRpc {
	latestHeight(): Promise<{ height: number | null }>;
	putNbtcTx(txHex: string, network: BitcoinNetwork): Promise<PutNbtcTxResponse>;
	statusByTxid(txid: string): Promise<TxStatusResp | null>;
	statusBySuiAddress(suiAddress: string): Promise<TxStatusResp[]>;
	depositsBySender(address: string): Promise<TxStatusResp[]>;
}
