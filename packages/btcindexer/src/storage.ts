import type {
	NbtcTxRow,
	PendingTx,
	MintTxStatus,
	FinalizedTxRow,
	ReorgedMintedTx,
	NbtcTxInsertion,
	NbtcTxUpdate,
	NbtcBroadcastedDeposit,
	NbtcPkgCfg,
	NbtcDepositAddrsMap,
	ConfirmingBlockInfo,
} from "./models";
import { D1Database } from "@cloudflare/workers-types";
import type { BlockQueueRecord, BtcNet } from "@gonative-cc/lib/nbtc";
import { toSuiNet } from "@gonative-cc/lib/nsui";

export interface Storage {
	// Block operations
	markBlockAsProcessed(hash: string, network: BtcNet): Promise<void>;
	insertBlockInfo(blockMessage: BlockQueueRecord): Promise<boolean>;
	getLatestBlockHeight(network: BtcNet): Promise<number | null>;
	getChainTip(network: BtcNet): Promise<number | null>;
	setChainTip(height: number, network: BtcNet): Promise<void>;
	getBlock(hash: string): Promise<ArrayBuffer | null>;
	getBlockHash(height: number, network: BtcNet): Promise<string | null>;
	getConfirmingBlocks(): Promise<ConfirmingBlockInfo[]>;

	// nBTC Transaction operations
	insertOrUpdateNbtcTxs(txs: NbtcTxInsertion[]): Promise<void>;

	getNbtcMintCandidates(maxRetries: number): Promise<FinalizedTxRow[]>;
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

// TODO: Add tests
// The current implementation fetches all addresses, but in the future,
// we might need to filter by an 'active' status in the 'nbtc_addresses' table.
/**
 * Fetches all nBTC deposit addresses from the D1 database.
 * @param db The D1 database binding.
 * @returns A promise that resolves to an array of NbtcAddress objects.
 */
export async function fetchNbtcAddresses(db: D1Database): Promise<NbtcDepositAddrsMap> {
	const { results } = await db
		.prepare(
			`SELECT a.package_id, a.deposit_address as btc_address,  a.is_active
			 FROM nbtc_deposit_addresses a
			 JOIN nbtc_packages p ON a.package_id = p.id
			 WHERE p.is_active = TRUE`,
		)
		.all<{ package_id: number; btc_address: string; is_active: boolean }>();
	const addrMap: NbtcDepositAddrsMap = new Map();
	for (const p of results || []) {
		addrMap.set(p.btc_address, { package_id: p.package_id, is_active: !!p.is_active });
	}
	return addrMap;
}

export async function fetchPackageConfigs(db: D1Database): Promise<NbtcPkgCfg[]> {
	let { results } = await db
		.prepare("SELECT * FROM nbtc_packages WHERE is_active = 1")
		.all<NbtcPkgCfg>();
	results = results || [];
	// verify DB
	for (const p of results) p.sui_network = toSuiNet(p.sui_network);

	return results.map((p) => ({ ...p, is_active: !!p.is_active }));
}
