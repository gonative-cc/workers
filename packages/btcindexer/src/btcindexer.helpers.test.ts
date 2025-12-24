import { Miniflare } from "miniflare";
import { Block } from "bitcoinjs-lib";
import { expect } from "bun:test";

import { Indexer } from "./btcindexer";
import { CFStorage } from "./cf-storage";
import type { SuiClientI } from "./sui_client";
import type { NbtcPkgCfg, NbtcDepositAddrsMap } from "./models";
import { MintTxStatus } from "./models";
import { BtcNet, type BlockQueueRecord } from "@gonative-cc/lib/nbtc";
import { toSuiNet, type SuiNet } from "@gonative-cc/lib/nsui";
import { initDb } from "./db.test";
import { mkElectrsServiceMock } from "./electrs.test";
import { MockSuiClient } from "./sui_client-mock";
import type { Electrs } from "./electrs";

export const SUI_FALLBACK_ADDRESS = "0xFALLBACK";

export const TEST_PACKAGE_CONFIG: NbtcPkgCfg = {
	id: 1,
	btc_network: BtcNet.REGTEST,
	sui_network: "testnet",
	nbtc_pkg: "0xPACKAGE",
	nbtc_contract: "0xNBTC",
	lc_contract: "0xLIGHTCLIENT",
	lc_pkg: "0xLC_PKG",
	sui_fallback_address: SUI_FALLBACK_ADDRESS,
	is_active: true,
};

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
	depositAddresses?: string[];
	packageConfig?: NbtcPkgCfg;
	confirmationDepth?: number;
	maxRetries?: number;
	customSuiClient?: MockSuiClient;
	testData?: TestBlocks;
}

interface MfBindings {
	DB: D1Database;
	BtcBlocks: KVNamespace;
	nbtc_txs: KVNamespace;
}

export class TesSuiteHelper {
	indexer: Indexer;
	db: D1Database;
	blocksKV: KVNamespace;
	txsKV: KVNamespace;
	storage: CFStorage;
	mockSuiClient: MockSuiClient;
	mockElectrs: Electrs;
	private testData: TestBlocks;
	private options: SetupOptions;

	constructor(options: SetupOptions = {}) {
		this.testData = options.testData || {};
		this.options = options;
		this.db = null!;
		this.blocksKV = null!;
		this.txsKV = null!;
		this.storage = null!;
		this.mockSuiClient = null!;
		this.mockElectrs = null!;
		this.indexer = null!;
	}

	async init(mf: Miniflare): Promise<void> {
		this.db = await mf.getD1Database("DB");
		await initDb(this.db);

		const env = (await mf.getBindings()) as MfBindings;
		this.storage = new CFStorage(env.DB, env.BtcBlocks, env.nbtc_txs);
		this.blocksKV = env.BtcBlocks;
		this.txsKV = env.nbtc_txs;

		const packageConfig: NbtcPkgCfg = this.options.packageConfig || TEST_PACKAGE_CONFIG;

		await this.db
			.prepare(
				`INSERT INTO setups (
					id, btc_network, sui_network, nbtc_pkg, nbtc_contract,
					lc_pkg, lc_contract,
					sui_fallback_address, is_active
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
				packageConfig.sui_fallback_address,
				packageConfig.is_active,
			)
			.run();

		const nbtcAddressesMap: NbtcDepositAddrsMap = new Map();
		const depositAddresses = this.options.depositAddresses || [];

		for (const addr of depositAddresses) {
			await this.db
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
		this.mockSuiClient = this.options.customSuiClient || new MockSuiClient();
		suiClients.set(toSuiNet(packageConfig.sui_network), this.mockSuiClient);

		const electrsClients = new Map<BtcNet, Electrs>();
		this.mockElectrs = mkElectrsServiceMock();
		electrsClients.set(BtcNet.REGTEST, this.mockElectrs);

		this.indexer = new Indexer(
			this.storage,
			[packageConfig],
			suiClients,
			nbtcAddressesMap,
			this.options.confirmationDepth || 8,
			this.options.maxRetries || 2,
			electrsClients,
		);
	}

	setupBlock = async (height: number): Promise<void> => {
		const blockData = this.testData[height];
		if (!blockData) throw new Error(`Block ${height} not found in test data`);
		await this.blocksKV.put(blockData.hash, Buffer.from(blockData.rawBlockHex, "hex").buffer);
	};

	getBlock = (height: number): Block => {
		const blockData = this.testData[height];
		if (!blockData) throw new Error(`Block ${height} not found in test data`);
		return Block.fromHex(blockData.rawBlockHex);
	};

	getTx = (height: number, txIndex: number) => {
		const blockData = this.testData[height];
		if (!blockData) throw new Error(`Block ${height} not found in test data`);

		const block = Block.fromHex(blockData.rawBlockHex);
		const txInfo = blockData.txs[txIndex];
		if (!txInfo) throw new Error(`Tx ${txIndex} not found in block ${height}`);

		const targetTx = block.transactions?.find((tx) => tx.getId() === txInfo.id);
		if (!targetTx) throw new Error(`Transaction ${txInfo.id} not found in block`);

		return { blockData, block, targetTx, txInfo };
	};

	createBlockQueueRecord = (
		height: number,
		options?: Partial<BlockQueueRecord>,
	): BlockQueueRecord => {
		const blockData = this.testData[height];
		if (!blockData) throw new Error(`Block ${height} not found in test data`);

		return {
			hash: options?.hash || blockData.hash,
			height: options?.height || blockData.height,
			network: options?.network || BtcNet.REGTEST,
			timestamp_ms: options?.timestamp_ms || Date.now(),
		};
	};

	mockElectrsSender = (address: string): void => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(this.mockElectrs.getTx as any).mockResolvedValue(
			new Response(
				JSON.stringify({
					vout: [{ scriptpubkey_address: address }],
				}),
			),
		);
	};

	mockElectrsError = (error: Error): void => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(this.mockElectrs.getTx as any).mockRejectedValue(error);
	};

	mockSuiMintBatch = (result: [boolean, string] | null): void => {
		this.mockSuiClient.tryMintNbtcBatch.mockResolvedValue(result);
	};

	insertTx = async (options: {
		txId: string;
		status: MintTxStatus | string;
		retryCount?: number;
		blockHeight?: number;
		blockHash?: string;
		suiRecipient?: string;
		amountSats?: number;
		depositAddress?: string;
		sender?: string;
		vout?: number;
	}): Promise<void> => {
		const defaultBlock =
			this.testData[329] || this.testData[327] || Object.values(this.testData)[0];
		if (!defaultBlock) throw new Error("No test data available for default values");

		const depositAddr = options.depositAddress || defaultBlock.depositAddr;

		const addressResult = await this.db
			.prepare(`SELECT id FROM nbtc_deposit_addresses WHERE deposit_address = ?`)
			.bind(depositAddr)
			.first<{ id: number }>();

		if (!addressResult) {
			throw new Error(
				`Deposit address '${depositAddr}' not found in database. ` +
					`Make sure to include it in the depositAddresses array during setupTestIndexer().`,
			);
		}

		await this.db
			.prepare(
				`INSERT INTO nbtc_minting (tx_id, address_id, sender, vout, block_hash, block_height, sui_recipient, amount_sats, status, created_at, updated_at, retry_count)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				options.txId,
				addressResult.id,
				options.sender || "sender_address",
				options.vout ?? 0,
				options.blockHash || defaultBlock.hash,
				options.blockHeight || defaultBlock.height,
				options.suiRecipient || "0xtest_recipient",
				options.amountSats || 10000,
				options.status,
				Date.now(),
				Date.now(),
				options.retryCount || 0,
			)
			.run();
	};

	expectMintingCount = async (count: number): Promise<void> => {
		const { results } = await this.db.prepare("SELECT * FROM nbtc_minting").all();
		expect(results.length).toEqual(count);
	};

	expectSenderCount = async (count: number, expectedAddress?: string): Promise<void> => {
		const { results } = await this.db.prepare("SELECT * FROM nbtc_minting").all();
		const recordsWithSender = results.filter((r) => r.sender && r.sender !== "");
		expect(recordsWithSender.length).toEqual(count);
		if (expectedAddress && recordsWithSender[0]) {
			expect(recordsWithSender[0].sender).toEqual(expectedAddress);
		}
	};

	expectTxStatus = async (txId: string, expectedStatus: MintTxStatus | string): Promise<void> => {
		const { results } = await this.db
			.prepare("SELECT status FROM nbtc_minting WHERE tx_id = ?")
			.bind(txId)
			.all();
		expect(results.length).toEqual(1);
		expect(results[0]).toBeDefined();
		expect(results[0]!.status).toEqual(expectedStatus);
	};
}
