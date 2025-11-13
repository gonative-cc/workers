import type { PutBlocks } from "./api/put-blocks";
import type { TxStatusResp } from "./models";

/**
 * Interface defining the BtcIndexer RPC functions.
 */
export interface InterfaceBtcIndexerRpc {
	putBlocks(blocks: PutBlocks[]): Promise<number>;
	latestHeight(): Promise<{ height: number | null }>;
	putNbtcTx(txHex: string): Promise<{ tx_id: string; registered_deposits: number }>;
	statusByTxid(txid: string): Promise<TxStatusResp | null>;
	statusBySuiAddress(suiAddress: string): Promise<TxStatusResp[]>;
	depositsBySender(address: string): Promise<TxStatusResp[]>;
}
