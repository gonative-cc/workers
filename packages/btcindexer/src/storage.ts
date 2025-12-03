import type {
	NbtcTxRow,
	PendingTx,
	MintTxStatus,
	FinalizedTxRow,
	ReorgedMintedTx,
	NbtcAddress,
	NbtcTxInsertion,
	NbtcTxUpdate,
	NbtcBroadcastedDeposit,
} from "./models";
import { D1Database } from "@cloudflare/workers-types";
import type { BlockQueueRecord } from "@gonative-cc/lib/nbtc";

export interface Storage {
	// Block operations
	markBlockAsProcessed(hash: string, network: string): Promise<void>;
	insertBlockInfo(blockMessage: BlockQueueRecord): Promise<boolean>;
	getLatestBlockHeight(): Promise<number | null>;
	getChainTip(): Promise<number | null>;
	setChainTip(height: number): Promise<void>;
	getBlock(hash: string): Promise<ArrayBuffer | null>;
	getBlockHash(height: number, network: string): Promise<string | null>;
	getConfirmingBlocks(): Promise<{ block_hash: string }[]>;

	// nBTC Transaction operations
	insertOrUpdateNbtcTxs(txs: NbtcTxInsertion[]): Promise<void>;

	getNbtcMintCandidates(maxRetries: number, suiNetwork: string): Promise<FinalizedTxRow[]>;
	getMintedTxs(blockHeight: number): Promise<FinalizedTxRow[]>;
	getTxStatus(txId: string): Promise<MintTxStatus | null>;
	getReorgedMintedTxs(blockHeight: number): Promise<ReorgedMintedTx[]>;
	updateNbtcTxsStatus(txIds: string[], status: MintTxStatus): Promise<void>;
	batchUpdateNbtcTxs(updates: NbtcTxUpdate[]): Promise<void>;
	updateConfirmingTxsToReorg(blockHashes: string[]): Promise<void>;
	getConfirmingTxs(): Promise<PendingTx[]>;
	finalizeNbtcTxs(txIds: string[]): Promise<void>;
	getNbtcMintTx(txid: string): Promise<NbtcTxRow | null>;
	getNbtcMintTxsBySuiAddr(suiAddress: string): Promise<NbtcTxRow[]>;
	registerBroadcastedNbtcTx(deposits: NbtcBroadcastedDeposit[]): Promise<void>;
	getNbtcMintTxsByBtcSender(btcAddress: string): Promise<NbtcTxRow[]>;
}

// TODO: Add support for active/inactive nBTC addresses.
// The current implementation fetches all addresses, but in the future,
// we might need to filter by an 'active' status in the 'nbtc_addresses' table.
/**
 * Fetches all nBTC deposit addresses from the D1 database.
 * @param db The D1 database binding.
 * @returns A promise that resolves to an array of NbtcAddress objects.
 */
export async function fetchNbtcAddresses(db: D1Database): Promise<NbtcAddress[]> {
	const { results } = await db
		.prepare(
			`SELECT a.deposit_address as btc_address, p.btc_network, p.sui_network, p.nbtc_pkg, a.is_active
			 FROM nbtc_deposit_addresses a
			 JOIN nbtc_packages p ON a.package_id = p.id`,
		)
		.all<NbtcAddress>();
	return results || [];
}
