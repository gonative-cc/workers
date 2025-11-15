import type { PutBlocks } from "./api/put-blocks";
import type { NbtcTxResp } from "./models";

/**
 * Interface defining the BtcIndexer RPC functions.
 */
export interface BtcIndexerRpcI {
	putBlocks(blocks: PutBlocks[]): Promise<number>;
	latestHeight(): Promise<{ height: number | null }>;
	putNbtcTx(txHex: string): Promise<{ tx_id: string; registered_deposits: number }>;
	statusByTxid(txid: string): Promise<NbtcTxResp | null>;
	statusBySuiAddress(suiAddress: string): Promise<NbtcTxResp[]>;
	depositsBySender(address: string): Promise<NbtcTxResp[]>;
}
