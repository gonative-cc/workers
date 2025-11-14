import { BitcoinNetwork } from "@gonative-cc/lib/bitcoin";
import type { TxStatusResp } from "./models";

/**
 * Interface defining the BtcIndexer RPC functions.
 */
export interface InterfaceBtcIndexerRpc {
	latestHeight(): Promise<{ height: number | null }>;
	putNbtcTx(
		txHex: string,
		network: BitcoinNetwork,
	): Promise<{ tx_id: string; registered_deposits: number }>;
	statusByTxid(txid: string): Promise<TxStatusResp | null>;
	statusBySuiAddress(suiAddress: string): Promise<TxStatusResp[]>;
	depositsBySender(address: string): Promise<TxStatusResp[]>;
}
