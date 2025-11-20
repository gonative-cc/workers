import { BtcNet } from "@gonative-cc/lib/nbtc";
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
	putNbtcTx(txHex: string, network: BtcNet): Promise<PutNbtcTxResponse>;
	nbtcMintTx(txid: string): Promise<NbtcTxResp | null>;
	nbtcMintTxsBySuiAddr(suiAddress: string): Promise<NbtcTxResp[]>;
	depositsBySender(address: string): Promise<NbtcTxResp[]>;
}
