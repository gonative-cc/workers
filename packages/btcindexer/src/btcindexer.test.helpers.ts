import { Miniflare } from "miniflare";
import { Block, type Transaction } from "bitcoinjs-lib";
import { expect } from "bun:test";
import type { D1Database, KVNamespace } from "@cloudflare/workers-types";

import { Indexer } from "./btcindexer";
import { CFStorage } from "./cf-storage";
import SuiClient from "./sui_client";
import type { NbtcAddress } from "./models";
import { MintTxStatus, type BlockQueueRecord } from "./models";
import { BtcNet } from "@gonative-cc/lib/nbtc";
import { initDb } from "./db.test";
import { mkElectrsServiceMock } from "./electrs.test";

export interface TxInfo {
	id: string;
	suiAddr: string;
	amountSats: number;
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
	depositAddresses?: NbtcAddress[];
	confirmationDepth?: number;
	maxRetries?: number;
	customSuiClient?: SuiClient;
	suiFallbackAddress?: string;
	testData?: TestBlocks;
}

export interface TestIndexerHelper {
	indexer: Indexer;
	db: D1Database;
	blocksKV: KVNamespace;
	txsKV: KVNamespace;
	storage: CFStorage;

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
	mockSuiMintBatch: (digest: string | null) => void;

	insertTx: (options: {
		txId: string;
		status: MintTxStatus;
		retryCount?: number;
		blockHeight?: number;
		blockHash?: string;
		suiRecipient?: string;
		amountSats?: number;
		depositAddress?: string;
		vout?: number;
	}) => Promise<void>;

	expectMintingCount: (count: number) => Promise<void>;
	expectSenderCount: (count: number, expectedAddress?: string) => Promise<void>;
	expectTxStatus: (txId: string, expectedStatus: MintTxStatus | string) => Promise<void>;
}

export async function setupTestIndexer(
	mf: Miniflare,
	options: SetupOptions = {},
): Promise<TestIndexerHelper> {
	const testData = options.testData || {};

	const db = await mf.getD1Database("DB");
	await initDb(db);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const env = (await mf.getBindings()) as any;
	const storage = new CFStorage(env.DB, env.btc_blocks, env.nbtc_txs);
	const blocksKV = env.btc_blocks as KVNamespace;
	const txsKV = env.nbtc_txs as KVNamespace;

	const nbtcAddressesMap = new Map<string, NbtcAddress>();
	const depositAddresses = options.depositAddresses || [];

	for (const addr of depositAddresses) {
		nbtcAddressesMap.set(addr.btc_address, addr);
	}

	const suiClient =
		options.customSuiClient ||
		new SuiClient({
			network: "testnet",
			nbtcPkg: "0xPACKAGE",
			nbtcModule: "test",
			nbtcContractId: "0xNBTC",
			lightClientObjectId: "0xLIGHTCLIENT",
			lightClientPackageId: "0xLC_PKG",
			lightClientModule: "lc_module",
			signerMnemonic:
				"test mnemonic test mnemonic test mnemonic test mnemonic test mnemonic test mnemonic",
		});

	const electrs = mkElectrsServiceMock();

	const indexer = new Indexer(
		storage,
		suiClient,
		nbtcAddressesMap,
		options.suiFallbackAddress || "0xFALLBACK",
		options.confirmationDepth || 8,
		options.maxRetries || 2,
		electrs,
	);

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
		(indexer.electrs.getTx as any).mockResolvedValue(
			new Response(
				JSON.stringify({
					vout: [{ scriptpubkey_address: address }],
				}),
			),
		);
	};

	const mockElectrsError = (error: Error): void => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(indexer.electrs.getTx as any).mockRejectedValue(error);
	};

	const mockSuiMintBatch = (digest: string | null): void => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(indexer.nbtcClient.tryMintNbtcBatch as any).mockResolvedValue(digest);
	};

	const insertTx = async (options: {
		txId: string;
		status: MintTxStatus;
		retryCount?: number;
		blockHeight?: number;
		blockHash?: string;
		suiRecipient?: string;
		amountSats?: number;
		depositAddress?: string;
		vout?: number;
	}): Promise<void> => {
		const defaultBlock = testData[329] || testData[327] || Object.values(testData)[0];
		if (!defaultBlock) throw new Error("No test data available for default values");

		await db
			.prepare(
				"INSERT INTO nbtc_minting (tx_id, vout, block_hash, block_height, sui_recipient, amount_sats, status, created_at, updated_at, retry_count, nbtc_pkg, sui_network, btc_network, deposit_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			)
			.bind(
				options.txId,
				options.vout ?? 0,
				options.blockHash || defaultBlock.hash,
				options.blockHeight || defaultBlock.height,
				options.suiRecipient || "0xtest_recipient",
				options.amountSats || 10000,
				options.status,
				Date.now(),
				Date.now(),
				options.retryCount || 0,
				"0xPACKAGE",
				"testnet",
				BtcNet.REGTEST,
				options.depositAddress || defaultBlock.depositAddr,
			)
			.run();
	};

	const expectMintingCount = async (count: number): Promise<void> => {
		const { results } = await db.prepare("SELECT * FROM nbtc_minting").all();
		expect(results.length).toEqual(count);
	};

	const expectSenderCount = async (count: number, expectedAddress?: string): Promise<void> => {
		const { results } = await db.prepare("SELECT * FROM nbtc_sender_deposits").all();
		expect(results.length).toEqual(count);
		if (expectedAddress && count > 0 && results[0]) {
			expect(results[0].sender).toEqual(expectedAddress);
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
		if (results[0]) {
			expect(results[0].status).toEqual(expectedStatus);
		}
	};

	return {
		indexer,
		db,
		blocksKV,
		txsKV,
		storage,
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
