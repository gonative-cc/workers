import { BtcNet } from "@gonative-cc/lib/nbtc";
import type { NbtcTxResp } from "./models";

// NOTE: we can't move this code to rpc.ts, otherwise the typecheck will confuse ENV type with
// ENV from other packages.

export interface PutNbtcTxResponse {
	tx_id: string;
	registered_deposits: number;
}

/**
 * Interface defining the BtcIndexer RPC functions.
 */
export interface BtcIndexerRpc {
	latestHeight(network: BtcNet): Promise<{ height: number | null }>;
	putNbtcTx(txHex: string, network: BtcNet): Promise<PutNbtcTxResponse>;
	broadcastRedeemTx(txHex: string, network: BtcNet, redeemId: number): Promise<{ tx_id: string }>;
	nbtcMintTx(txid: string): Promise<NbtcTxResp | null>;
	nbtcMintTxsBySuiAddr(suiAddress: string): Promise<NbtcTxResp[]>;
	depositsBySender(address: string, network: BtcNet): Promise<NbtcTxResp[]>;
}
