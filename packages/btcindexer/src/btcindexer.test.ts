import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from "bun:test";
import { Miniflare } from "miniflare";
import { join } from "path";
import { Block, networks } from "bitcoinjs-lib";

import { BtcNet, type BlockQueueRecord } from "@gonative-cc/lib/nbtc";

import { Indexer, parseSuiRecipientFromOpReturn } from "./btcindexer";
import { OP_RETURN } from "./opcodes";
import type { Deposit, ProofResult } from "./models";
import { MintTxStatus, InsertBlockStatus } from "./models";
import { setupTestIndexerSuite, type TestIndexerHelper } from "./btcindexer.helpers.test";

interface TxInfo {
	id: string;
	suiAddr: string;
	amount: number;
}

interface TestBlock {
	depositAddr: string;
	height: number;
	hash: string;
	rawBlockHex: string;
	txs: Record<string, TxInfo>;
}

type TestBlocks = Record<number, TestBlock>;

// generated using bitcoin-cli --regtest
const REGTEST_DATA: TestBlocks = {
	329: {
		depositAddr: "bcrt1qfnyeg7dd5vqs2mtc4rekwm8mgpxkj647p39zhw",
		height: 329,
		hash: "28145bffb6dcd5a1ffff596bf3abc451d00f5322dd2aa0f1c62b21314c8da193",
		rawBlockHex:
			"000000306306a7a77a5edbd1291bc5cc4fc7befcac57a54389717625e72f15f9e5032337b217d3ce0b5d5d3672bcc90e64b7c879cd89372d742bf97bb3ec06dd26a80566ffb9ca68ffff7f200000000002020000000001010000000000000000000000000000000000000000000000000000000000000000ffffffff0402490100ffffffff02ba83814a00000000160014970b960dcb40385f21cb1b3f943f80e59efc60130000000000000000266a24aa21a9ede1f866b225eb31b1f836fdb4996825ec24e708cce5da2a1417c922e4cb5a86eb0120000000000000000000000000000000000000000000000000000000000000000000000000020000000001014d169a4e5b94219f8dc7f12492b5b23556d15447d2be7166e78b4028e730e18e0000000000fdffffff0350c30000000000001600144cc99479ada301056d78a8f3676cfb404d696abe1a21fd9400000000160014d9e0684e75b195ed7dcaa869cec83edeea15a8e50000000000000000236a2100bbad40ecca892cf0d54ba0b9c986454be0695ce29642223a02c37e3b87a4499c0247304402205e74c8406c7ce0dc6c0e71fb12e8d49e12af629d91861e35706cb15569c3ad31022051c00b0e1d6d77da4e4bfa31ca0a4b532989e1e4db78f6fe68fd3baf0cd5ede3012103729dbfb24ebf0c9ea58b02b9374aeeb3b42ac05a64cdfffe12db81fdd9c8298300000000",
		txs: {
			1: {
				id: "8af4f7ceb96f41d16a932936f763b75ba778f28c37a2409371267cc2b22a3ec3",
				suiAddr: "0xbbad40ecca892cf0d54ba0b9c986454be0695ce29642223a02c37e3b87a4499c",
				amount: 50000,
			},
		},
	},
	327: {
		depositAddr: "bcrt1qfnyeg7dd5vqs2mtc4rekwm8mgpxkj647p39zhw",
		height: 327,
		hash: "9e8cbaeb4b4bb6caa1348b1ce39aac60b5eb16d4ada1710167d7d2dba494b1f6",
		rawBlockHex:
			"000000309e02811147a48d71d33ce8b4acaeeb4d6ffb43a9aaf1e1564160422724aed63fb9603c099517313df9118b0a1bde44ec77ed0c581da79c4e52067b686ffa81feaa93ca68ffff7f200000000003020000000001010000000000000000000000000000000000000000000000000000000000000000ffffffff0402470100ffffffff02ea8a814a000000001600144d92b0bf448dde39553e93a06ca04b8cc7e449ec0000000000000000266a24aa21a9ed584e9196713025fba31e8bd4d3980c610196d6fab5408fbf041993fb3ebf70ab012000000000000000000000000000000000000000000000000000000000000000000000000002000000000101fd2df0a3bf517b009c7d2bf1b5d9d9900a3702f4f66bbcaf7fc7762159d7344b0100000000fdffffff0370110100000000001600144cc99479ada301056d78a8f3676cfb404d696abe0000000000000000236a210011223344556677889900aabbccddeeff0011223344556677889900aabbccdd00c0c70095000000001600146832da4e5b5e1db2d0fa2e485e9e4484536e98090247304402202431b1446d9dbd5d95d50bcc6489877207d89e7ed563aad7abc9745fc09d8afe02200d392e6e8789893a84a2d7edc48f34f75c5a0184c8a4606df0c44aa167431aaa012103c340c0b1657023b8cd3349e8c5239a36651fa03d75876e7a6d520af55ef5cd2200000000020000000001016ec7be18e2ccf0642f36ae8e0d3e9d12973ef0d38d1bea0fbb2f18edb159c2f50200000000fdffffff0360ea0000000000001600144cc99479ada301056d78a8f3676cfb404d696abe0000000000000000236a2100aabbccddeeff00112233445566778899aabbccddeeff001122334455667788992eb6fe940000000016001401f073c70b560278eb5be6c6ece81b2d9524c9c202473044022002132a77bbfec74aacf4265be5e9f165c75cfc5cfcb95df2b3fc2c7bf3bb94d102203eed6272738859056b10d021dd4c18af57be89080a264e3af6cfe39559de128201210386d157e283bbe381db6069007e15a8fcc71d88672fa8d6522903c4089c77b40800000000",
		txs: {
			1: {
				id: "3d40280c5a2700dd64c8957252444e7b25f9bdd2046b581ea4f864fa04b9979e",
				suiAddr: "0x11223344556677889900aabbccddeeff0011223344556677889900aabbccdd00",
				amount: 70000,
			},
			2: {
				id: "9752c64f7c40ffbfce444ceead859cec41f4ab8e51829bb0d7383f26c9a86e7c",
				suiAddr: "0xaabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
				amount: 60000,
			},
		},
	},
};

let mf: Miniflare;
let indexer: Indexer;
let suite: TestIndexerHelper;

beforeAll(async () => {
	mf = new Miniflare({
		script: "",
		modules: true,
		d1Databases: ["DB"],
		kvNamespaces: ["BtcBlocks", "nbtc_txs"],
		d1Persist: false,
		kvPersist: false,
		cachePersist: false,
	});
});

afterAll(async () => {
	await mf.dispose();
});

beforeEach(async () => {
	suite = await setupTestIndexerSuite(mf, {
		depositAddresses: [REGTEST_DATA[329]!.depositAddr],
		confirmationDepth: 8,
		maxRetries: 2,
		testData: REGTEST_DATA,
	});

	indexer = suite.indexer;
});

afterEach(async () => {
	// restores all spies after each test
	jest.restoreAllMocks();
	await suite.cleanupDB();
});

function checkTxProof(proofResult: ProofResult | null, block: Block) {
	expect(proofResult).toBeDefined();
	expect(block.merkleRoot).toBeDefined();

	const expectedRootBigEndian = Buffer.from(block.merkleRoot!).reverse().toString("hex");
	expect(proofResult!.merkleRoot).toEqual(expectedRootBigEndian);

	expect(Array.isArray(proofResult!.proofPath)).toBeTrue();
	expect(proofResult!.proofPath.length).toBeGreaterThan(0);
	for (const element of proofResult!.proofPath) {
		expect(Buffer.isBuffer(element)).toBeTrue();
		expect(element.length).toEqual(32);
	}
}

describe("Indexer.findNbtcDeposits", () => {
	it("should correctly parse a single deposit from a real regtest transaction", () => {
		const block = Block.fromHex(REGTEST_DATA[329]!.rawBlockHex);
		const targetTx = block.transactions?.find(
			(tx) => tx.getId() === REGTEST_DATA[329]!.txs[1]!.id,
		);

		expect(targetTx).toBeDefined();

		const deposits = indexer.findNbtcDeposits(targetTx!, networks.regtest);
		expect(deposits.length).toEqual(1);
		expect(deposits[0]!.amount).toEqual(REGTEST_DATA[329]!.txs[1]!.amount);
		expect(deposits[0]!.suiRecipient).toEqual(REGTEST_DATA[329]!.txs[1]!.suiAddr);
		expect(deposits[0]!.vout).toEqual(0);
	});
	it("should find multiple deposits within a single block containing multiple transactions", () => {
		const block = Block.fromHex(REGTEST_DATA[327]!.rawBlockHex);
		expect(block.transactions).toBeDefined();

		const deposits: Deposit[][] = [];
		for (const tx of block.transactions!) {
			const d = indexer.findNbtcDeposits(tx, networks.regtest);
			if (d.length > 0)
				// coinbase, nbtc_deposit_1, nbtc_deposit_2, other_tx
				deposits.push(d);
		}

		expect(deposits.length).toEqual(2);
		// TX_1
		expect(deposits[0]![0]!.suiRecipient).toEqual(REGTEST_DATA[327]!.txs[1]!.suiAddr);
		expect(deposits[0]![0]!.amount).toEqual(REGTEST_DATA[327]!.txs[1]!.amount);
		// TX 2
		expect(deposits[1]![0]!.suiRecipient).toEqual(REGTEST_DATA[327]!.txs[2]!.suiAddr);
		expect(deposits[1]![0]!.amount).toEqual(REGTEST_DATA[327]!.txs[2]!.amount);
	});
});

describe("Indexer.processBlock", () => {
	const timestamp_ms = Date.now();
	it("should process a block and insert nBTC transactions and sender deposits", async () => {
		const blockQueueMessage = suite.createBlockQueueRecord(329, { timestamp_ms });
		const fakeSenderAddress = "bc1qtestsenderaddress";

		await suite.setupBlock(329);
		suite.mockElectrsSender(fakeSenderAddress);

		await indexer.processBlock(blockQueueMessage);

		await suite.expectMintingCount(1);
		await suite.expectSenderCount(1, fakeSenderAddress);
	});
});

describe("Indexer.constructMerkleProof", () => {
	it("should generate a valid proof for a real regtest transaction", () => {
		const block = Block.fromHex(REGTEST_DATA[329]!.rawBlockHex);
		const targetTx = block.transactions?.find(
			(tx) => tx.getId() === REGTEST_DATA[329]!.txs[1]!.id,
		);

		expect(targetTx).toBeDefined();

		const tree = indexer.constructMerkleTree(block);
		expect(tree).toBeDefined();
		const proofPath = indexer.getTxProof(tree!, targetTx!);
		expect(proofPath).toBeDefined();
		const merkleRoot = tree!.getRoot(true).toString("hex");
		checkTxProof({ proofPath: proofPath!, merkleRoot }, block);
	});

	it("should generate a valid proof for a block with an odd number of transactions (3 txs)", () => {
		const block = Block.fromHex(REGTEST_DATA[327]!.rawBlockHex);
		const targetTx = block.transactions?.find(
			(tx) => tx.getId() === REGTEST_DATA[327]!.txs[2]!.id,
		);

		expect(targetTx).toBeDefined();

		const tree = indexer.constructMerkleTree(block);
		expect(tree).toBeDefined();
		const proofPath = indexer.getTxProof(tree!, targetTx!);
		expect(proofPath).toBeDefined();
		const merkleRoot = tree!.getRoot(true).toString("hex");
		checkTxProof({ proofPath: proofPath!, merkleRoot }, block);
	});
});

describe("Indexer.splitActiveInactiveTxs", () => {
	it("should return active ID when address is active", () => {
		const pendingTx = {
			tx_id: "tx1",
			block_hash: null,
			block_height: 100,
			btc_network: BtcNet.REGTEST,
			deposit_address: REGTEST_DATA[329]!.depositAddr,
		};
		const { activeTxIds } = indexer.splitActiveInactiveTxs([pendingTx]);
		expect(activeTxIds.length).toEqual(1);
		expect(activeTxIds[0]).toEqual("tx1");
	});
});

describe("Indexer.splitActiveInactiveTxs (Inactive)", () => {
	it("should return inactiveId if address is not active", () => {
		const pkg = indexer.getPackageConfig(1);
		if (pkg) pkg.is_active = false;

		const pendingTx = {
			tx_id: "tx1",
			block_hash: null,
			block_height: 100,
			btc_network: BtcNet.REGTEST,
			deposit_address: REGTEST_DATA[329]!.depositAddr,
		};
		const result = indexer.splitActiveInactiveTxs([pendingTx]);

		expect(result.activeTxIds.length).toEqual(0);
		expect(result.inactiveTxIds.length).toEqual(1);

		// Restore active state for other tests
		if (pkg) pkg.is_active = true;
	});

	it("should return inactiveId if address is inactive but package is active", () => {
		const pendingTx = {
			tx_id: "tx1",
			block_hash: null,
			block_height: 100,
			btc_network: BtcNet.REGTEST,
			deposit_address: "inactive_address",
		};

		const originalMap = indexer.nbtcDepositAddrMap;
		indexer.nbtcDepositAddrMap = new Map([
			[
				"inactive_address",
				{
					setup_id: 1,
					is_active: false,
				},
			],
		]);

		const result = indexer.splitActiveInactiveTxs([pendingTx]);

		expect(result.activeTxIds.length).toEqual(0);
		expect(result.inactiveTxIds.length).toEqual(1);

		indexer.nbtcDepositAddrMap = originalMap;
	});
});

describe.skip("Indexer.updateConfirmationsAndFinalize", () => {
	it("should finalize transactions with enough confirmations", async () => {
		// const indexer = await indexerFromEnv(env);
		// await indexer.updateConfirmationsAndFinalize();
	});
});

describe("Block Parsing", () => {
	it("should correctly parse block 94160 from testnet", async () => {
		// Paste the full raw block hex from bitcoin-cli here
		const rawBlockHex = await Bun.file(join(__dirname, "testdata/block94160.txt")).text();

		const block = Block.fromHex(rawBlockHex);
		// This test checks if the Block.fromHex() function throws an error.
		// If it throws the 'RangeError', the test will fail.
		expect(() => {
			Block.fromHex(rawBlockHex);
		}).not.toThrow();

		expect(block.getId()).toEqual(
			"0000000000000001524e39e399572fa8af575a22217f64ca3280be55eb10b06e",
		);
	});
});

describe("Indexer.registerBroadcastedNbtcTx", () => {
	it("should register a new tx with a single deposit", async () => {
		const { targetTx, txInfo } = suite.getTx(329, 1);
		const txHex = targetTx.toHex();

		const result = await indexer.registerBroadcastedNbtcTx(txHex, BtcNet.REGTEST);
		expect(result.tx_id).toEqual(txInfo.id);
		expect(result.registered_deposits).toEqual(1);

		const { results } = await suite.db.prepare("SELECT * FROM nbtc_minting").all();
		expect(results.length).toEqual(1);
		expect(results[0]!.tx_id).toEqual(txInfo.id);
		expect(results[0]!.vout).toEqual(0);
		expect(results[0]!.sui_recipient).toEqual(txInfo.suiAddr);
		expect(results[0]!.amount).toEqual(txInfo.amount);
	});

	it("should return 0 registered_deposits when tx already exists", async () => {
		const { txInfo, targetTx } = suite.getTx(329, 1);
		const txHex = targetTx.toHex();

		const firstResult = await indexer.registerBroadcastedNbtcTx(txHex, BtcNet.REGTEST);
		expect(firstResult.registered_deposits).toEqual(1);

		const secondResult = await indexer.registerBroadcastedNbtcTx(txHex, BtcNet.REGTEST);
		expect(secondResult.tx_id).toEqual(txInfo.id);
		expect(secondResult.registered_deposits).toEqual(0);

		await suite.expectMintingCount(1);
	});

	it("should throw an error for a transaction with no valid deposits", async () => {
		const block = suite.getBlock(329);
		expect(block.transactions).toBeDefined();
		const coinbaseTx = block.transactions![0]!;

		expect(
			indexer.registerBroadcastedNbtcTx(coinbaseTx.toHex(), BtcNet.REGTEST),
		).rejects.toThrow("Transaction does not contain any valid nBTC deposits.");
	});
});

describe("Indexer.hasNbtcMintTx", () => {
	it("should return false when transaction does not exist", async () => {
		const result = await indexer.hasNbtcMintTx("nonexistent_tx_id");
		expect(result).toBe(false);
	});

	it("should return true when transaction exists", async () => {
		const { targetTx, txInfo } = suite.getTx(329, 1);
		const txHex = targetTx.toHex();

		await indexer.registerBroadcastedNbtcTx(txHex, BtcNet.REGTEST);

		const result = await indexer.hasNbtcMintTx(txInfo.id);
		expect(result).toBe(true);
	});
});

describe("Indexer.processFinalizedTransactions", () => {
	it("should process finalized transactions, group them, and call the SUI batch mint function", async () => {
		const tx329 = REGTEST_DATA[329]!.txs[1]!;

		await suite.insertTx({ txId: tx329.id, status: MintTxStatus.Finalized });
		await suite.setupBlock(329);

		const fakeSuiTxDigest = "5fSnS1NCf2bYH39n18aGo41ggd2a7sWEy42533g46T2e";
		suite.mockSuiClient.tryMintNbtcBatch.mockResolvedValue([true, fakeSuiTxDigest]);

		await indexer.processFinalizedTransactions();
		expect(suite.mockSuiClient.tryMintNbtcBatch).toHaveBeenCalledTimes(1);

		const { results } = await suite.db
			.prepare("SELECT * FROM nbtc_minting WHERE tx_id = ?")
			.bind(tx329.id)
			.all();
		expect(results.length).toEqual(1);
		expect(results[0]!.sui_tx_id).toEqual(fakeSuiTxDigest);
	});
});

describe("Indexer.processFinalizedTransactions Sanctions Filtering", () => {
	it("should skip sanctioned addresses and not mint", async () => {
		const txData = REGTEST_DATA[329]!.txs[1]!;

		await suite.insertTx({ txId: txData.id, status: MintTxStatus.Finalized });
		await suite.setupBlock(329);

		// Mock compliance to block all addresses
		const mockIsBtcBlocked = jest.fn().mockImplementation((addresses: string[]) => {
			const result: Record<string, boolean> = {};
			for (const addr of addresses) {
				result[addr] = true; // Block all addresses
			}
			return Promise.resolve(result);
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		indexer.compliance = { isBtcBlocked: mockIsBtcBlocked } as any;

		await indexer.processFinalizedTransactions();

		expect(mockIsBtcBlocked).toHaveBeenCalled();
		expect(suite.mockSuiClient.tryMintNbtcBatch).not.toHaveBeenCalled();
		await suite.expectTxStatus(txData.id, MintTxStatus.Finalized);
	});
});

describe("Indexer.processFinalizedTransactions Retry Logic", () => {
	it("should retry a failed tx and succeed", async () => {
		const txData = REGTEST_DATA[329]!.txs[1]!;

		await suite.insertTx({ txId: txData.id, status: MintTxStatus.Finalized });
		await suite.setupBlock(329);

		const fakeSuiTxDigest = "5fSnS1NCf2bYH39n18aGo41ggd2a7sWEy42533g46T2e";
		suite.mockSuiClient.tryMintNbtcBatch.mockResolvedValue([true, fakeSuiTxDigest]);

		await indexer.processFinalizedTransactions();

		expect(suite.mockSuiClient.tryMintNbtcBatch).toHaveBeenCalledTimes(1);
		const { results } = await suite.db
			.prepare("SELECT * FROM nbtc_minting WHERE tx_id = ?")
			.bind(txData.id)
			.all();
		expect(results.length).toEqual(1);
		expect(results[0]!.sui_tx_id).toEqual(fakeSuiTxDigest);
	});

	it("should retry a failed tx, fail again, and increment retry_count", async () => {
		const txData = REGTEST_DATA[329]!.txs[1]!;

		await suite.insertTx({ txId: txData.id, status: MintTxStatus.Finalized, retryCount: 1 });
		await suite.setupBlock(329);

		suite.mockSuiClient.tryMintNbtcBatch.mockResolvedValue(null);

		await indexer.processFinalizedTransactions();

		expect(suite.mockSuiClient.tryMintNbtcBatch).toHaveBeenCalledTimes(1);
		const { results } = await suite.db
			.prepare("SELECT * FROM nbtc_minting WHERE tx_id = ?")
			.bind(txData.id)
			.all();
		expect(results.length).toEqual(1);
		expect(results[0]!.retry_count).toEqual(2);
	});

	it("should store digest for on-chain execution failure", async () => {
		const blockData = REGTEST_DATA[329]!;
		const txData = blockData.txs[1]!;

		await suite.insertTx({ txId: txData.id, status: MintTxStatus.Finalized });
		await suite.setupBlock(329);

		const failedSuiTxDigest = "0xfailed123abc456def789onchain_execution_error";
		suite.mockSuiClient.tryMintNbtcBatch.mockResolvedValue([false, failedSuiTxDigest]);

		await indexer.processFinalizedTransactions();

		expect(suite.mockSuiClient.tryMintNbtcBatch).toHaveBeenCalledTimes(1);
		const { results } = await suite.db
			.prepare("SELECT * FROM nbtc_minting WHERE tx_id = ?")
			.bind(txData.id)
			.all();
		expect(results.length).toEqual(1);
		expect(results[0]!.status).toEqual("mint-failed");
		expect(results[0]!.sui_tx_id).toEqual(failedSuiTxDigest);
		expect(results[0]!.retry_count).toEqual(1);
	});

	it("should handle pre-submission failure without digest", async () => {
		const blockData = REGTEST_DATA[329]!;
		const txData = blockData.txs[1]!;

		await suite.insertTx({ txId: txData.id, status: MintTxStatus.Finalized });
		await suite.setupBlock(329);

		suite.mockSuiClient.tryMintNbtcBatch.mockResolvedValue(null);

		await indexer.processFinalizedTransactions();

		expect(suite.mockSuiClient.tryMintNbtcBatch).toHaveBeenCalledTimes(1);
		const { results } = await suite.db
			.prepare("SELECT * FROM nbtc_minting WHERE tx_id = ?")
			.bind(txData.id)
			.all();
		expect(results.length).toEqual(1);
		expect(results[0]!.status).toEqual("mint-failed");
		expect(results[0]!.sui_tx_id).toBeNull();
		expect(results[0]!.retry_count).toEqual(1);
	});
});

describe("Storage.getNbtcMintCandidates", () => {
	it("should return finalized txs as mint candidates", async () => {
		await suite.insertTx({ txId: "finalized_tx", status: MintTxStatus.Finalized });

		const candidates = await indexer.storage.getNbtcMintCandidates(3);

		expect(candidates.length).toEqual(1);
		expect(candidates[0]!.tx_id).toEqual("finalized_tx");
	});

	it("should return mint-failed txs within retry limit as mint candidates", async () => {
		await suite.insertTx({
			txId: "failed_tx",
			status: MintTxStatus.MintFailed,
			retryCount: 2,
		});

		const candidates = await indexer.storage.getNbtcMintCandidates(3);

		expect(candidates.length).toEqual(1);
		expect(candidates[0]!.tx_id).toEqual("failed_tx");
	});

	it("should NOT return mint-failed txs exceeding retry limit", async () => {
		await suite.insertTx({
			txId: "failed_tx_exceeds",
			status: MintTxStatus.MintFailed,
			retryCount: 5,
		});

		const candidates = await indexer.storage.getNbtcMintCandidates(3);

		expect(candidates).toHaveLength(0);
	});

	it("should NOT return minted txs", async () => {
		await suite.insertTx({ txId: "minted_tx", status: MintTxStatus.Minted });

		const candidates = await indexer.storage.getNbtcMintCandidates(3);

		expect(candidates).toHaveLength(0);
	});

	it("should NOT return reorg txs (finalized-reorg or minted-reorg)", async () => {
		await suite.insertTx({ txId: "finalized_reorg_tx", status: MintTxStatus.FinalizedReorg });
		await suite.insertTx({ txId: "minted_reorg_tx", status: MintTxStatus.MintedReorg });

		const candidates = await indexer.storage.getNbtcMintCandidates(3);

		expect(candidates).toHaveLength(0);
	});

	it("should return both finalized and mint-failed txs within retry limit together", async () => {
		await suite.insertTx({ txId: "finalized_tx", status: MintTxStatus.Finalized });
		await suite.insertTx({
			txId: "failed_tx_within_limit",
			status: MintTxStatus.MintFailed,
			retryCount: 2,
		});
		await suite.insertTx({
			txId: "failed_tx_exceeds_limit",
			status: MintTxStatus.MintFailed,
			retryCount: 5,
		});

		const candidates = await indexer.storage.getNbtcMintCandidates(3);

		expect(candidates.length).toEqual(2);
		const txIds = candidates.map((c) => c.tx_id).sort();
		expect(txIds).toEqual(["failed_tx_within_limit", "finalized_tx"]);
	});
});

describe("Indexer.detectMintedReorgs", () => {
	it("should not update status if no reorg detected", async () => {
		const blockData = REGTEST_DATA[329]!;
		const txData = blockData.txs[1]!;

		await suite.insertTx({ txId: txData.id, status: MintTxStatus.Minted });

		await suite.db
			.prepare(
				"INSERT INTO btc_blocks (hash, height, network, inserted_at, is_scanned) VALUES (?, ?, ?, ?, ?)",
			)
			.bind(blockData.hash, blockData.height, BtcNet.REGTEST, Date.now(), 1)
			.run();

		await indexer.detectMintedReorgs(blockData.height);

		const status = await indexer.storage.getTxStatus(txData.id);
		expect(status).toEqual(MintTxStatus.Minted);
	});
});

describe("Indexer.processBlock", () => {
	const timestamp_ms = Date.now();
	it("should process a block and insert nBTC transactions and sender deposits", async () => {
		const blockInfo = suite.createBlockQueueRecord(329, { timestamp_ms });
		const fakeSenderAddress = "bc1qtestsenderaddress";

		await suite.setupBlock(329);
		suite.mockElectrsSender(fakeSenderAddress);

		await indexer.processBlock(blockInfo);

		await suite.expectMintingCount(1);
		await suite.expectSenderCount(1, fakeSenderAddress);
	});

	it("should call detectMintedReorgs when processing a block that causes a reorg", async () => {
		const blockData329 = REGTEST_DATA[329]!;
		const txData = blockData329.txs[1]!;

		await suite.insertTx({ txId: txData.id, status: MintTxStatus.Minted });
		await suite.setupBlock(329);

		await suite.db
			.prepare(
				"INSERT INTO btc_blocks (hash, height, network, inserted_at, is_scanned) VALUES (?, ?, ?, ?, ?)",
			)
			.bind(blockData329.hash, blockData329.height, BtcNet.REGTEST, timestamp_ms, 1)
			.run();

		const reorgBlockInfo = suite.createBlockQueueRecord(327, {
			height: blockData329.height,
			timestamp_ms: timestamp_ms + 1000,
		});
		await suite.setupBlock(327);
		await indexer.processBlock(reorgBlockInfo);

		const status = await indexer.storage.getTxStatus(txData.id);
		expect(status).toEqual(MintTxStatus.MintedReorg);
	});
});

describe("CFStorage.insertBlockInfo (Stale Block Protection)", () => {
	it("should return TRUE and insert data when block is new", async () => {
		const record: BlockQueueRecord = {
			hash: "hash_100_initial",
			height: 100,
			network: BtcNet.REGTEST,
			timestamp_ms: 1000,
		};

		const result = await indexer.storage.insertBlockInfo(record);
		expect(result).toBe(InsertBlockStatus.Inserted);
		const row = await suite.db.prepare("SELECT * FROM btc_blocks WHERE height = 100").first();
		expect(row).toEqual(
			expect.objectContaining({
				hash: "hash_100_initial",
				inserted_at: 1000,
			}),
		);
	});

	it("should return TRUE and update data when incoming block is NEWER (Reorg)", async () => {
		await indexer.storage.insertBlockInfo({
			hash: "hash_100_old",
			height: 100,
			network: BtcNet.REGTEST,
			timestamp_ms: 1000,
		});

		//  "Reorg" block (Newer timestamp)
		const newerRecord: BlockQueueRecord = {
			hash: "hash_100_new",
			height: 100, // Same height
			network: BtcNet.REGTEST,
			timestamp_ms: 2000, // 2000 > 1000
		};

		const result = await indexer.storage.insertBlockInfo(newerRecord);

		expect(result).toBe(InsertBlockStatus.Updated);
		const row = await suite.db.prepare("SELECT * FROM btc_blocks WHERE height = 100").first();
		expect(row).toEqual(
			expect.objectContaining({
				hash: "hash_100_new",
				inserted_at: 2000,
			}),
		);
	});

	it("should return FALSE and IGNORE data when incoming block is OLDER (Stale Retry)", async () => {
		await indexer.storage.insertBlockInfo({
			hash: "hash_100_new",
			height: 100,
			network: BtcNet.REGTEST,
			timestamp_ms: 2000,
		});

		// This represents a message stuck in the queue from before the reorg
		const staleRecord: BlockQueueRecord = {
			hash: "hash_100_old",
			height: 100,
			network: BtcNet.REGTEST,
			timestamp_ms: 1000, // 1000 < 2000
		};

		const result = await indexer.storage.insertBlockInfo(staleRecord);

		expect(result).toBe(InsertBlockStatus.Skipped);
		const row = await suite.db.prepare("SELECT * FROM btc_blocks WHERE height = 100").first();
		expect(row).toEqual(
			expect.objectContaining({
				hash: "hash_100_new",
				inserted_at: 2000,
			}),
		);
	});
});

describe("Indexer.verifyConfirmingBlocks", () => {
	const block329 = REGTEST_DATA[329]!;
	const tx329 = block329.txs[1]!;

	it("should verify confirming blocks with on-chain light client and update reorged transactions", async () => {
		await suite.insertTx({
			txId: tx329.id,
			status: "confirming" as MintTxStatus,
			blockHash: block329.hash,
			blockHeight: block329.height,
			suiRecipient: tx329.suiAddr,
			amount: tx329.amount,
			depositAddress: block329.depositAddr,
		});

		suite.mockSuiClient.verifyBlocks.mockResolvedValue([false]);

		await indexer.verifyConfirmingBlocks();
		expect(
			suite.mockSuiClient.verifyBlocks,
			"Verify that verifyBlocks was called with the correct block hash",
		).toHaveBeenCalledWith([block329.hash]);
		await suite.expectTxStatus(tx329.id, "reorg");
	});

	it("should verify confirming blocks and not update status if blocks are still valid", async () => {
		await suite.insertTx({
			txId: tx329.id,
			status: "confirming" as MintTxStatus,
			blockHash: block329.hash,
			blockHeight: block329.height,
			suiRecipient: tx329.suiAddr,
			amount: tx329.amount,
			depositAddress: block329.depositAddr,
		});

		suite.mockSuiClient.verifyBlocks.mockResolvedValue([true]);

		await indexer.verifyConfirmingBlocks();
		expect(
			suite.mockSuiClient.verifyBlocks,
			"Verify that verifyBlocks was called with the correct block hash",
		).toHaveBeenCalledWith([block329.hash]);

		// Check that the transaction status remains 'confirming' since block is still valid
		await suite.expectTxStatus(tx329.id, "confirming");
	});

	it("should handle empty confirming blocks list", async () => {
		await indexer.verifyConfirmingBlocks();
		expect(suite.mockSuiClient.verifyBlocks).not.toHaveBeenCalled();
	});

	it("should handle SPV verification failure gracefully without updating the status", async () => {
		await suite.insertTx({
			txId: tx329.id,
			status: "confirming" as MintTxStatus,
			blockHash: block329.hash,
			blockHeight: block329.height,
			suiRecipient: tx329.suiAddr,
			amount: tx329.amount,
			depositAddress: block329.depositAddr,
		});

		suite.mockSuiClient.verifyBlocks.mockRejectedValue(new Error("SPV verification failed"));
		await indexer.verifyConfirmingBlocks();

		expect(suite.mockSuiClient.verifyBlocks).toHaveBeenCalledWith([block329.hash]);
		await suite.expectTxStatus(tx329.id, "confirming");
	});
});

describe("Indexer.getSenderAddresses (via processBlock)", () => {
	const timestamp_ms = Date.now();

	it("should handle Electrs API failure when fetching sender addresses", async () => {
		const blockInfo = suite.createBlockQueueRecord(329, { timestamp_ms });
		await suite.setupBlock(329);
		suite.mockElectrsError(new Error("Electrs API failed"));

		await indexer.processBlock(blockInfo);

		// Check that the transaction was still processed and added to nbtc_minting table
		// but no sender deposits were added due to the API failure
		await suite.expectMintingCount(1);
		await suite.expectSenderCount(0);
	});

	it("should correctly fetch sender addresses when Electrs API is successful", async () => {
		const fakeSenderAddress = "bc1qtestsenderaddress";
		const blockInfo = suite.createBlockQueueRecord(329, { timestamp_ms });

		await suite.setupBlock(329);
		suite.mockElectrsSender(fakeSenderAddress);

		await indexer.processBlock(blockInfo);

		// Check that the transaction was processed and sender address was stored
		await suite.expectMintingCount(1);
		await suite.expectSenderCount(1, fakeSenderAddress);
	});

	it("should handle Electrs API returning invalid response", async () => {
		const blockInfo = suite.createBlockQueueRecord(329, { timestamp_ms });

		await suite.setupBlock(329);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(suite.mockElectrs.getTx as any).mockResolvedValue(
			new Response(JSON.stringify({}), { status: 404 }),
		);

		await indexer.processBlock(blockInfo);

		// Should still have the nBTC deposits but no sender deposits due to invalid response
		await suite.expectMintingCount(1);
		await suite.expectSenderCount(0);
	});
});

describe("parseSuiRecipientFromOpReturn", () => {
	it("should return null if script is empty", () => {
		expect(parseSuiRecipientFromOpReturn(Buffer.alloc(0))).toBeNull();
	});

	it("should return null if script does not start with OP_RETURN", () => {
		const script = Buffer.from([0x01, 0x00]);
		expect(parseSuiRecipientFromOpReturn(script)).toBeNull();
	});

	it("should return null if script is too short", () => {
		const script = Buffer.from([OP_RETURN]);
		expect(parseSuiRecipientFromOpReturn(script)).toBeNull();
	});

	it("should return null if payload flag is not 0x00", () => {
		// this test will have to be updated once we start supporting other flags
		const script = Buffer.concat([
			Buffer.from([OP_RETURN, 33]),
			Buffer.from([0x01]), // flag 0x01
			Buffer.alloc(32, 0x01),
		]);
		expect(parseSuiRecipientFromOpReturn(script)).toBeNull();
	});

	it("should return null if address length is not 32 bytes", () => {
		const script = Buffer.concat([
			Buffer.from([OP_RETURN, 32]),
			Buffer.from([0x00]),
			Buffer.alloc(31, 0x01), // 31 bytes addr
		]);
		expect(parseSuiRecipientFromOpReturn(script)).toBeNull();
	});

	it("should return valid sui address if data is correct", () => {
		const addressBytes = Buffer.alloc(32, 0xaa);
		const addressHex = `0x${addressBytes.toString("hex")}`;
		const script = Buffer.concat([
			Buffer.from([OP_RETURN, 33]), // OP_RETURN + length
			Buffer.from([0x00]), // flag
			addressBytes,
		]);
		expect(parseSuiRecipientFromOpReturn(script)).toBe(addressHex);
	});

	it("should return the address if it follows valid sui address format", () => {
		const script = Buffer.concat([
			Buffer.from([OP_RETURN, 33]),
			Buffer.from([0x00]),
			Buffer.alloc(32, 0x01),
		]);
		const result = parseSuiRecipientFromOpReturn(script);
		expect(result).toBe("0x0101010101010101010101010101010101010101010101010101010101010101");
	});

	it("should return null if address is not 32 bytes (too long)", () => {
		const script = Buffer.concat([
			Buffer.from([OP_RETURN, 34]),
			Buffer.from([0x00]),
			Buffer.alloc(33, 0x01),
		]);
		expect(parseSuiRecipientFromOpReturn(script)).toBeNull();
	});
});
