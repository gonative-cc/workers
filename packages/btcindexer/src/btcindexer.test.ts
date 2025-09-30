import { describe, it, assert, vi, expect } from "vitest";
import { promises as fs } from "fs";
import { Indexer, storageFromEnv } from "../src/btcindexer";
import { Block, networks } from "bitcoinjs-lib";
import { SuiClient, SuiClientCfg } from "./sui_client";
import { Deposit, ProofResult } from "./models";

interface TxInfo {
	id: string;
	suiAddr: string;
	amountSats: number;
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
				amountSats: 50000,
			},
		},
	},
	327: {
		depositAddr: "bcrt1qfnyeg7dd5vqs2mtc4rekwm8mgpxkj647p39zhw",
		height: 327,
		hash: "44ebd5a48c4b7410eb92f527a382d7d9de88f7450e47de099e4197a6a473a36b",
		rawBlockHex:
			"000000309e02811147a48d71d33ce8b4acaeeb4d6ffb43a9aaf1e1564160422724aed63f5aeaa3f37c1c99da4079cc60a2d72ed164ee1e08a44942c765a44ad5801fb580aa93ca68ffff7f200000000003020000000001010000000000000000000000000000000000000000000000000000000000000000ffffffff0402470100ffffffff02ea8a814a000000001600144d92b0bf448dde39553e93a06ca04b8cc7e449ec0000000000000000266a24aa21a9ed584e9196713025fba31e8bd4d3980c610196d6fab5408fbf041993fb3ebf70ab012000000000000000000000000000000000000000000000000000000000000000000000000002000000000101fd2df0a3bf517b009c7d2bf1b5d9d9900a3702f4f66bbcaf7fc7762159d7344b0100000000fdffffff0370110100000000001600144cc99479ada301056d78a8f3676cfb404d696abe0000000000000000226a200011223344556677889900aabbccddeeff0011223344556677889900aabbccddc0c70095000000001600146832da4e5b5e1db2d0fa2e485e9e4484536e98090247304402202431b1446d9dbd5d95d50bcc6489877207d89e7ed563aad7abc9745fc09d8afe02200d392e6e8789893a84a2d7edc48f34f75c5a0184c8a4606df0c44aa167431aaa012103c340c0b1657023b8cd3349e8c5239a36651fa03d75876e7a6d520af55ef5cd2200000000020000000001016ec7be18e2ccf0642f36ae8e0d3e9d12973ef0d38d1bea0fbb2f18edb159c2f50200000000fdffffff0360ea0000000000001600144cc99479ada301056d78a8f3676cfb404d696abe0000000000000000236a2100aabbccddeeff00112233445566778899aabbccddeeff001122334455667788992eb6fe940000000016001401f073c70b560278eb5be6c6ece81b2d9524c9c202473044022002132a77bbfec74aacf4265be5e9f165c75cfc5cfcb95df2b3fc2c7bf3bb94d102203eed6272738859056b10d021dd4c18af57be89080a264e3af6cfe39559de128201210386d157e283bbe381db6069007e15a8fcc71d88672fa8d6522903c4089c77b40800000000",
		txs: {
			1: {
				id: "22c0c042fd2b8bc083079987d9690ecebe9a74d427b0148888637065097e3f49",
				suiAddr: "0x11223344556677889900aabbccddeeff0011223344556677889900aabbccdd",
				amountSats: 70000,
			},
			2: {
				id: "9752c64f7c40ffbfce444ceead859cec41f4ab8e51829bb0d7383f26c9a86e7c",
				suiAddr: "0xaabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
				amountSats: 60000,
			},
		},
	},
};

const SUI_FALLBACK_ADDRESS = "0xFALLBACK";
// TODO: ideally we should use Miniflare here, as in the auction tests. We can do it later.
// https://github.com/gonative-cc/byield/blob/master/app/server/BeelieversAuction/auction.server.test.ts
const createMockStmt = () => ({
	bind: vi.fn().mockReturnThis(),
	all: vi.fn().mockResolvedValue({ results: [] }),
});

function mkMockD1() {
	return {
		prepare: vi.fn().mockImplementation(() => createMockStmt()),
		batch: vi.fn().mockResolvedValue({ success: true }),
	};
}

const SUI_CLIENT_CFG: SuiClientCfg = {
	network: "testnet",
	nbtcPkg: "0xPACKAGE",
	nbtcModule: "test",
	nbtcObjectId: "0xNBTC",
	lightClientObjectId: "0xLIGHTCLIENT",
	signerMnemonic:
		"test mnemonic test mnemonic test mnemonic test mnemonic test mnemonic test mnemonic",
};

const mkMockEnv = () =>
	({
		DB: mkMockD1(),
		btc_blocks: {},
		nbtc_txs: {},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	}) as any;

function prepareIndexer() {
	const mockEnv = mkMockEnv();
	const storage = storageFromEnv(mockEnv);

	const indexer = new Indexer(
		storage,
		new SuiClient(SUI_CLIENT_CFG),
		REGTEST_DATA[329].depositAddr,
		SUI_FALLBACK_ADDRESS,
		networks.regtest,
		8,
	);
	return { mockEnv, indexer };
}

function checkTxProof(proofResult: ProofResult | null, block: Block) {
	assert(proofResult, "Proof result should not be null");
	assert(block.merkleRoot, "Block must have a Merkle root");

	const expectedRootBigEndian = Buffer.from(block.merkleRoot).reverse().toString("hex");
	assert.equal(
		proofResult.merkleRoot,
		expectedRootBigEndian,
		"Generated Merkle root must match the block header's root",
	);

	assert(Array.isArray(proofResult.proofPath));
	assert(proofResult.proofPath.length > 0);
	for (const element of proofResult.proofPath) {
		assert(Buffer.isBuffer(element));
		assert.equal(element.length, 32);
	}
}

describe("Indexer.findNbtcDeposits", () => {
	const indexer = prepareIndexer().indexer;
	it("should correctly parse a single deposit from a real regtest transaction", () => {
		const block = Block.fromHex(REGTEST_DATA[329].rawBlockHex);
		const targetTx = block.transactions?.find(
			(tx) => tx.getId() === REGTEST_DATA[329].txs[1].id,
		);

		assert(targetTx, "Setup error");

		const deposits = indexer.findNbtcDeposits(targetTx);
		assert.equal(deposits.length, 1);
		assert.equal(deposits[0].amountSats, REGTEST_DATA[329].txs[1].amountSats);
		assert.equal(deposits[0].suiRecipient, REGTEST_DATA[329].txs[1].suiAddr);
		assert.equal(deposits[0].vout, 0);
	});
	it("should find multiple deposits within a single block containing multiple transactions", () => {
		const block = Block.fromHex(REGTEST_DATA[327].rawBlockHex);
		assert(block.transactions, "Test block must contain transactions");

		const deposits: Deposit[][] = [];
		for (const tx of block.transactions) {
			const d = indexer.findNbtcDeposits(tx);
			if (d.length > 0)
				// coinbase, nbtc_deposit_1, nbtc_deposit_2, other_tx
				deposits.push(d);
		}

		assert.equal(deposits.length, 2);
		// TX_1
		assert.equal(deposits[0][0].suiRecipient, REGTEST_DATA[327].txs[1].suiAddr);
		assert.equal(deposits[0][0].amountSats, REGTEST_DATA[327].txs[1].amountSats);
		// TX 2
		assert.equal(deposits[1][0].suiRecipient, REGTEST_DATA[327].txs[2].suiAddr);
		assert.equal(deposits[1][0].amountSats, REGTEST_DATA[327].txs[2].amountSats);
	});
});

describe.skip("Indexer.scanNewBlocks", () => {
	it("should be tested later", () => {
		// TODO: add a test for the scanNewBlocks using the same data
	});
});

describe("Indexer.constructMerkleProof", () => {
	const indexer = prepareIndexer().indexer;
	it("should generate a valid proof for a real regtest transaction", () => {
		const block = Block.fromHex(REGTEST_DATA[329].rawBlockHex);
		const targetTx = block.transactions?.find(
			(tx) => tx.getId() === REGTEST_DATA[329].txs[1].id,
		);
		assert(targetTx);

		const tree = indexer.constructMerkleTree(block);
		assert(tree);
		const proofPath = indexer.getTxProof(tree, targetTx);
		assert(proofPath);
		const merkleRoot = tree.getRoot(true).toString("hex");
		checkTxProof({ proofPath, merkleRoot }, block);
	});

	it("should generate a valid proof for a block with an odd number of transactions (3 txs)", () => {
		const block = Block.fromHex(REGTEST_DATA[327].rawBlockHex);
		const targetTx = block.transactions?.find(
			(tx) => tx.getId() === REGTEST_DATA[327].txs[2].id,
		);

		assert(targetTx);

		const tree = indexer.constructMerkleTree(block);
		assert(tree);
		const proofPath = indexer.getTxProof(tree, targetTx);
		assert(proofPath);
		const merkleRoot = tree.getRoot(true).toString("hex");
		checkTxProof({ proofPath, merkleRoot }, block);
	});
});

describe("Indexer.handleReorgs", () => {
	const { mockEnv, indexer } = prepareIndexer();
	it("should do nothing if no reorg", async () => {
		const pendingTx = { tx_id: "tx1", block_hash: "hash_A", block_height: 100 };
		const mockStatement = {
			bind: vi.fn().mockReturnThis(),
			first: vi.fn().mockResolvedValue({ hash: "hash_A" }),
		};
		mockEnv.DB.prepare.mockReturnValue(mockStatement);
		const { reorgUpdates } = await indexer.handleReorgs([pendingTx]);
		assert.equal(reorgUpdates.length, 0);
	});

	it("should generate a reset statement if reorg detected", async () => {
		const pendingTx = { tx_id: "tx1", block_hash: "hash_A", block_height: 100 };
		const mockStatement = {
			bind: vi.fn().mockReturnThis(),
			first: vi.fn().mockResolvedValue({ hash: "hash_A_reorged" }),
		};
		mockEnv.DB.prepare.mockReturnValue(mockStatement);
		const { reorgUpdates } = await indexer.handleReorgs([pendingTx]);
		assert.equal(reorgUpdates.length, 1);
	});
});

describe("Indexer.findFinalizedTxs", () => {
	const indexer = prepareIndexer().indexer;
	it("should generate a finalize statement when enough confirmations", () => {
		const pendingTx = { tx_id: "tx1", block_hash: null, block_height: 100 };
		const latestHeight = 107;
		const updates = indexer.selectFinalizedNbtcTxs([pendingTx], latestHeight);
		assert.equal(updates.length, 1);
	});

	it("should do nothing when not enough confirmations", () => {
		const pendingTx = { tx_id: "tx1", block_hash: null, block_height: 100 };
		const latestHeight = 106;
		const updates = indexer.selectFinalizedNbtcTxs([pendingTx], latestHeight);
		assert.equal(updates.length, 0);
	});
});

describe.skip("Indexer.updateConfirmationsAndFinalize", () => {
	it("should be tested later", () => {
		// TODO: add a test for the scanNewBlocks using the same data
	});
});

describe("Block Parsing", () => {
	it("should correctly parse block 94160 from testnet", async () => {
		// Paste the full raw block hex from bitcoin-cli here
		const rawBlockHex = await fs.readFile(
			"packages/btcindexer/src/testdata/block94160.txt",
			"utf8",
		);

		const block = Block.fromHex(rawBlockHex);
		// This test checks if the Block.fromHex() function throws an error.
		// If it throws the 'RangeError', the test will fail.
		expect(() => {
			Block.fromHex(rawBlockHex);
		}).not.toThrow();

		assert.equal(
			block.getId(),
			"0000000000000001524e39e399572fa8af575a22217f64ca3280be55eb10b06e",
		);
	});
});

describe("Indexer.registerBroadcastedNbtcTx", () => {
	it("should register a tx with a single deposit", async () => {
		const { mockEnv, indexer } = prepareIndexer();
		const blockData = REGTEST_DATA[329];
		const block = Block.fromHex(blockData.rawBlockHex);
		const targetTx = block.transactions?.find((tx) => tx.getId() === blockData.txs[1].id);
		assert(targetTx);

		const txHex = targetTx.toHex();
		await indexer.registerBroadcastedNbtcTx(txHex);

		const insertStmt = mockEnv.DB.prepare.mock.results[0].value;
		expect(mockEnv.DB.prepare).toHaveBeenCalledWith(
			expect.stringContaining("INSERT OR IGNORE INTO nbtc_minting"),
		);
		expect(insertStmt.bind).toHaveBeenCalledWith(
			blockData.txs[1].id,
			0, // vout
			blockData.txs[1].suiAddr,
			blockData.txs[1].amountSats,
			expect.any(Number),
			expect.any(Number),
		);
	});

	it("should throw an error for a transaction with no valid deposits", async () => {
		const { indexer } = prepareIndexer();
		const block = Block.fromHex(REGTEST_DATA[329].rawBlockHex);
		assert(block.transactions);
		// The first tx in a block is coinbase
		const coinbaseTx = block.transactions[0];

		await expect(indexer.registerBroadcastedNbtcTx(coinbaseTx.toHex())).rejects.toThrow(
			"Transaction does not contain any valid nBTC deposits.",
		);
	});
});

describe("Indexer.processFinalizedTransactions", () => {
	it("should process finalized transactions, group them, and call the SUI batch mint function", async () => {
		const { mockEnv, indexer } = prepareIndexer();
		const block329 = REGTEST_DATA[329];
		const tx329 = block329.txs[1];
		const mockFinalizedTxs = {
			results: [
				{
					tx_id: tx329.id,
					vout: 0,
					block_hash: block329.hash,
					block_height: block329.height,
				},
			],
		};
		const mockSelectStmt = createMockStmt();
		mockSelectStmt.all.mockResolvedValue(mockFinalizedTxs);

		const mockUpdateStmt = createMockStmt();
		mockEnv.DB.prepare.mockReturnValueOnce(mockSelectStmt).mockReturnValue(mockUpdateStmt);

		const mockKvGet = vi.fn().mockResolvedValue(Buffer.from(block329.rawBlockHex, "hex"));
		mockEnv.btc_blocks.get = mockKvGet;

		const fakeSuiTxDigest = "5fSnS1NCf2bYH39n18aGo41ggd2a7sWEy42533g46T2e";
		const suiClientSpy = vi
			.spyOn(indexer.nbtcClient, "tryMintNbtcBatch")
			.mockResolvedValue(fakeSuiTxDigest);

		await indexer.processFinalizedTransactions();
		expect(suiClientSpy).toHaveBeenCalledTimes(1);

		const finalDbBatchCall = mockEnv.DB.batch.mock.calls[0][0];
		expect(finalDbBatchCall).toHaveLength(1);
		expect(mockUpdateStmt.bind).toHaveBeenCalledWith(
			fakeSuiTxDigest,
			expect.any(Number),
			tx329.id,
			0,
		);
	});
});
