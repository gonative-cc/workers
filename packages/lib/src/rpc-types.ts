import { BitcoinTxStatus, BtcNet } from "./nbtc";

// --- Sui Indexer RPC Types ---

export enum RedeemStatusEnum {
	Pending = "pending",
	Proposed = "proposed",
	Signing = "signing",
	Signed = "signed",
}

export type RedeemRequestStatus = RedeemStatusEnum | BitcoinTxStatus;
export const RedeemRequestStatus = { ...RedeemStatusEnum, ...BitcoinTxStatus };

export interface ConfirmingRedeemReq {
	redeem_id: number;
	btc_tx: string;
	btc_block_height: number;
	btc_block_hash: string;
	btc_network: string;
}

export interface FinalizeRedeemTx {
	redeemId: number;
	proof: string[]; // hex encoded
	height: number;
	txIndex: number;
}

export interface RedeemRequestEventRaw {
	redeem_id: string;
	redeemer: string;
	recipient_script: string;
	amount: string;
	created_at: string;
}

export interface RedeemRequestResp {
	redeem_id: number;
	recipient_script: string;
	amount: number;
	status: RedeemRequestStatus;
	created_at: number;
	sui_tx: string;
	btc_tx: string | null; // null if not broadcasted
	confirmations: number; // 0 if not broadcasted
}

export interface SuiIndexerRpc {
	finalizeRedeems: (requests: FinalizeRedeemTx[]) => Promise<void>;
	putRedeemTx: (setupId: number, suiTxId: string, e: RedeemRequestEventRaw) => Promise<void>;
	getBroadcastedRedeemTxIds: (network: string) => Promise<string[]>;
	confirmRedeem: (txIds: string[], blockHeight: number, blockHash: string) => Promise<void>;
	redeemsBySuiAddr: (setupId: number, suiAddr: string) => Promise<RedeemRequestResp[]>;
	getConfirmingRedeems: (network: string) => Promise<ConfirmingRedeemReq[]>;
	updateRedeemStatus: (redeemId: number, status: RedeemRequestStatus) => Promise<void>;
	updateRedeemStatuses: (redeemIds: number[], status: RedeemRequestStatus) => Promise<void>;
}

// --- BTC Indexer RPC Types ---

export interface PutNbtcTxResponse {
	tx_id: string;
	registered_deposits: number;
}

export interface NbtcTxRespRpc {
	btcTxId: string;
}
