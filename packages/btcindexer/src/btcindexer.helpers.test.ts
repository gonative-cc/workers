import { Miniflare } from "miniflare";
import { Block, type Transaction } from "bitcoinjs-lib";
import { expect } from "bun:test";
import type { D1Database, KVNamespace, Service } from "@cloudflare/workers-types";
import type { WorkerEntrypoint } from "cloudflare:workers";
import { BtcNet, type BlockQueueRecord } from "@gonative-cc/lib/nbtc";
import { toSuiNet, type SuiNet } from "@gonative-cc/lib/nsui";
import { D1Storage } from "@gonative-cc/sui-indexer/storage";
import {
	type SuiIndexerRpc,
	RedeemRequestStatus,
	type FinalizeRedeemTx,
} from "@gonative-cc/lib/rpc-types";
import { dropTables, initDb } from "@gonative-cc/lib/test-helpers/init_db";
import { Indexer } from "./btcindexer";
import { CFStorage } from "./cf-storage";
import type { SuiClientI } from "./sui_client";
import type { NbtcPkgCfg, NbtcDepositAddrsMap } from "./models";
import { MintTxStatus } from "./models";
import { mkElectrsServiceMock } from "./electrs.test";
import { MockSuiClient } from "./sui_client-mock";
import type { Electrs } from "./electrs";
import { TestEnvName } from "@gonative-cc/lib/setups";
import type { ComplianceRpc } from "@gonative-cc/compliance/rpc";

export const SUI_FALLBACK_ADDRESS = "0xFALLBACK";

export const TEST_PACKAGE_CONFIG: NbtcPkgCfg = {
	id: 1,
	btc_network: BtcNet.REGTEST,
	sui_network: "testnet",
	nbtc_pkg: "0xPACKAGE",
	nbtc_contract: "0xNBTC",
	lc_contract: "0xLIGHTCLIENT",
	lc_pkg: "0xLC_PKG",
	nbtc_fallback_addr: SUI_FALLBACK_ADDRESS,
	is_active: true,
};

export interface TxInfo {
	id: string;
	suiAddr: string;
	amount: number;
}

export interface TestBlock {
	depositAddr: string;
	height: number;
	hash: string;
	rawBlockHex: string;
	txs: Record<string, TxInfo>;
}

export type TestBlocks = Record<number, TestBlock>;

interface SetupOptions {
	depositAddresses?: string[];
	packageConfig?: NbtcPkgCfg;
	confirmationDepth?: number;
	maxRetries?: number;
	customSuiClient?: MockSuiClient;
	testData?: TestBlocks;
}

export interface TestIndexerHelper {
	indexer: Indexer;
	db: D1Database;
	blocksKV: KVNamespace;
	txsKV: KVNamespace;
	storage: CFStorage;
	mockSuiClient: MockSuiClient;
	mockElectrs: Electrs;

	cleanupDB(): Promise<D1ExecResult>;

	setupBlock: (height: number) => Promise<void>;
	getBlock: (height: number) => Block;
	getTx: (
		height: number,
		txIndex: number,
	) => {
		blockData: TestBlock;
		block: Block;
		targetTx: Transaction;
		txInfo: TxInfo;
	};
	createBlockQueueRecord: (
		height: number,
		options?: Partial<BlockQueueRecord>,
	) => BlockQueueRecord;

	mockElectrsSender: (address: string) => void;
	mockElectrsError: (error: Error) => void;
	mockSuiMintBatch: (result: [boolean, string] | null) => void;

	insertTx: (options: {
		txId: string;
		status: MintTxStatus | string;
		retryCount?: number;
		blockHeight?: number;
		blockHash?: string;
		suiRecipient?: string;
		amount?: number;
		depositAddress?: string;
		sender?: string;
		vout?: number;
	}) => Promise<void>;

	expectMintingCount: (count: number) => Promise<void>;
	expectSenderCount: (count: number, expectedAddress?: string) => Promise<void>;
	expectTxStatus: (txId: string, expectedStatus: MintTxStatus | string) => Promise<void>;
}

// test suite helper functions constructor.
export async function setupTestIndexerSuite(
	mf: Miniflare,
	options: SetupOptions = {},
): Promise<TestIndexerHelper> {
	const testData = options.testData || {};

	const db = await mf.getD1Database("DB");
	await initDb(db);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const env = (await mf.getBindings()) as any;
	const storage = new CFStorage(env.DB, env.BtcBlocks, env.nbtc_txs);
	const blocksKV = env.BtcBlocks as KVNamespace;
	const txsKV = env.nbtc_txs as KVNamespace;

	const packageConfig: NbtcPkgCfg = options.packageConfig || TEST_PACKAGE_CONFIG;

	await db
		.prepare(
			`INSERT INTO setups (
				id, btc_network, sui_network, nbtc_pkg, nbtc_contract,
				lc_pkg, lc_contract,
				nbtc_fallback_addr, is_active
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			packageConfig.id,
			packageConfig.btc_network,
			packageConfig.sui_network,
			packageConfig.nbtc_pkg,
			packageConfig.nbtc_contract,
			packageConfig.lc_pkg,
			packageConfig.lc_contract,
			packageConfig.nbtc_fallback_addr,
			packageConfig.is_active,
		)
		.run();

	const nbtcAddressesMap: NbtcDepositAddrsMap = new Map();
	const depositAddresses = options.depositAddresses || [];

	for (const addr of depositAddresses) {
		await db
			.prepare(
				`INSERT INTO nbtc_deposit_addresses (setup_id, deposit_address, is_active)
				 VALUES (?, ?, 1)`,
			)
			.bind(packageConfig.id, addr)
			.run();

		nbtcAddressesMap.set(addr, {
			setup_id: packageConfig.id,
			is_active: true,
		});
	}

	const suiClients = new Map<SuiNet, SuiClientI>();
	const mockSuiClient = options.customSuiClient || new MockSuiClient();
	suiClients.set(toSuiNet(packageConfig.sui_network), mockSuiClient);

	const electrsClients = new Map<BtcNet, Electrs>();
	const mockElectrs = mkElectrsServiceMock();
	electrsClients.set(BtcNet.REGTEST, mockElectrs);

	const indexerStorage = new D1Storage(db, TestEnvName);

	const mockSuiIndexerService = {
		getBroadcastedRedeemTxIds: (network: BtcNet) =>
			indexerStorage.getBroadcastedBtcRedeemTxIds(network),
		confirmRedeem: (txIds: string[], blockHeight: number, blockHash: string) =>
			indexerStorage.confirmRedeem(txIds, blockHeight, blockHash),
		finalizeRedeems: async (requests: FinalizeRedeemTx[]) => {
			await Promise.all(requests.map((r) => indexerStorage.setRedeemFinalized(r.redeemId)));
		},
		putRedeemTx: () => Promise.resolve(),
		getConfirmingRedeems: (network: string) => indexerStorage.getConfirmingRedeems(network),
		updateRedeemStatus: (redeemId: number, status: RedeemRequestStatus) =>
			indexerStorage.updateRedeemStatus(redeemId, status),
		updateRedeemStatuses: (redeemIds: number[], status: RedeemRequestStatus) =>
			indexerStorage.updateRedeemStatuses(redeemIds, status),
	} as unknown as Service<SuiIndexerRpc & WorkerEntrypoint>;

	const mockComplianceService: ComplianceRpc = {
		isAnyBtcAddressSanctioned: (addrs: string[]): Promise<boolean> =>
			// returns true if there is an address with last character being digit
			Promise.resolve(addrs.findIndex((a) => /\d$/.test(a)) >= 0),
	};

	const indexer = new Indexer(
		storage,
		[packageConfig],
		suiClients,
		nbtcAddressesMap,
		options.confirmationDepth || 8,
		options.maxRetries || 2,
		electrsClients,
		mockSuiIndexerService,
		mockComplianceService,
	);

	//
	// Interface functions
	//

	const cleanupDB = () => dropTables(db);

	const setupBlock = async (height: number): Promise<void> => {
		const blockData = testData[height];
		if (!blockData) throw new Error(`Block ${height} not found in test data`);
		await blocksKV.put(blockData.hash, Buffer.from(blockData.rawBlockHex, "hex").buffer);
	};

	const getBlock = (height: number): Block => {
		const blockData = testData[height];
		if (!blockData) throw new Error(`Block ${height} not found in test data`);
		return Block.fromHex(blockData.rawBlockHex);
	};

	const getTx = (height: number, txIndex: number) => {
		const blockData = testData[height];
		if (!blockData) throw new Error(`Block ${height} not found in test data`);

		const block = Block.fromHex(blockData.rawBlockHex);
		const txInfo = blockData.txs[txIndex];
		if (!txInfo) throw new Error(`Tx ${txIndex} not found in block ${height}`);

		const targetTx = block.transactions?.find((tx) => tx.getId() === txInfo.id);
		if (!targetTx) throw new Error(`Transaction ${txInfo.id} not found in block`);

		return { blockData, block, targetTx, txInfo };
	};

	const createBlockQueueRecord = (
		height: number,
		options?: Partial<BlockQueueRecord>,
	): BlockQueueRecord => {
		const blockData = testData[height];
		if (!blockData) throw new Error(`Block ${height} not found in test data`);

		return {
			hash: options?.hash || blockData.hash,
			height: options?.height || blockData.height,
			network: options?.network || BtcNet.REGTEST,
			timestamp_ms: options?.timestamp_ms || Date.now(),
		};
	};

	const mockElectrsSender = (address: string): void => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(mockElectrs.getTx as any).mockResolvedValue(
			new Response(
				JSON.stringify({
					vout: [{ scriptpubkey_address: address }],
				}),
			),
		);
	};

	const mockElectrsError = (error: Error): void => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(mockElectrs.getTx as any).mockRejectedValue(error);
	};

	const mockSuiMintBatch = (result: [boolean, string] | null): void => {
		mockSuiClient.tryMintNbtcBatch.mockResolvedValue(result);
	};

	const insertTx = async (args: {
		txId: string;
		status: MintTxStatus | string;
		retryCount?: number;
		blockHeight?: number;
		blockHash?: string;
		suiRecipient?: string;
		amount?: number;
		depositAddress?: string;
		sender?: string;
		vout?: number;
	}): Promise<void> => {
		const defaultBlock = testData[329] || testData[327] || Object.values(testData)[0];
		if (!defaultBlock) throw new Error("No test data available for default values");

		const depositAddr = args.depositAddress || defaultBlock.depositAddr;
		await db
			.prepare(
				`INSERT INTO nbtc_minting (tx_id, address_id, sender, vout, block_hash, block_height, sui_recipient, amount, status, created_at, updated_at, retry_count)
				 VALUES (
				  ?,
				  (SELECT id FROM nbtc_deposit_addresses WHERE deposit_address = ?),
				  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				args.txId,
				depositAddr,
				args.sender || "sender_address",
				args.vout ?? 0,
				args.blockHash || defaultBlock.hash,
				args.blockHeight || defaultBlock.height,
				args.suiRecipient || "0xtest_recipient",
				args.amount || 10000,
				args.status,
				Date.now(),
				Date.now(),
				args.retryCount || 0,
			)
			.run();
	};

	const expectMintingCount = async (count: number): Promise<void> => {
		const { results } = await db.prepare("SELECT * FROM nbtc_minting").all();
		expect(results.length).toEqual(count);
	};

	const expectSenderCount = async (count: number, expectedAddress?: string): Promise<void> => {
		const { results } = await db.prepare("SELECT * FROM nbtc_minting").all();
		const recordsWithSender = results.filter((r) => r.sender && r.sender !== "");
		expect(recordsWithSender.length).toEqual(count);
		if (expectedAddress && recordsWithSender[0]) {
			expect(recordsWithSender[0].sender).toEqual(expectedAddress);
		}
	};

	const expectTxStatus = async (
		txId: string,
		expectedStatus: MintTxStatus | string,
	): Promise<void> => {
		const { results } = await db
			.prepare("SELECT status FROM nbtc_minting WHERE tx_id = ?")
			.bind(txId)
			.all();
		expect(results.length).toEqual(1);
		expect(results[0]).toBeDefined();
		expect(results[0]!.status).toEqual(expectedStatus);
	};

	return {
		indexer,
		db,
		blocksKV,
		txsKV,
		storage,
		mockSuiClient,
		mockElectrs,
		// functions
		cleanupDB,
		setupBlock,
		getBlock,
		getTx,
		createBlockQueueRecord,
		mockElectrsSender,
		mockElectrsError,
		mockSuiMintBatch,
		insertTx,
		expectMintingCount,
		expectSenderCount,
		expectTxStatus,
	};
}
