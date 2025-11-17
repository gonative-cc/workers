import { describe, it, vi, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { Miniflare } from "miniflare";

import { join } from "path";
import { Block, networks } from "bitcoinjs-lib";

import { Indexer } from "./btcindexer";
import { CFStorage } from "./cf-storage";
import SuiClient, { type SuiClientCfg } from "./sui_client";
import type { Deposit, ProofResult, NbtcAddress } from "./models";
import { MintTxStatus } from "./models";
import { initDb } from "./db.test";
import { mkElectrsServiceMock } from "./electrs.test";

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

const SUI_CLIENT_CFG: SuiClientCfg = {
	network: "testnet",
	nbtcPkg: "0xPACKAGE",
	nbtcModule: "test",
	nbtcContractId: "0xNBTC",
	lightClientObjectId: "0xLIGHTCLIENT",
	lightClientPackageId: "0xLC_PKG",
	lightClientModule: "lc_module",
	signerMnemonic:
		"test mnemonic test mnemonic test mnemonic test mnemonic test mnemonic test mnemonic",
};

let mf: Miniflare;
let indexer: Indexer;

beforeAll(async () => {
	mf = new Miniflare({
		script: "",
		modules: true,
		d1Databases: ["DB"],
		kvNamespaces: ["btc_blocks", "nbtc_txs"],
		d1Persist: false,
		kvPersist: false,
		cachePersist: false,
	});
});

afterAll(async () => {
	await mf.dispose();
});

beforeEach(async () => {
	const db = await mf.getD1Database("DB");
	await initDb(db);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const env = (await mf.getBindings()) as any;
	const storage = new CFStorage(env.DB, env.btc_blocks, env.nbtc_txs);
	const nbtcAddressesMap = new Map<string, NbtcAddress>();
	const testNbtcAddress: NbtcAddress = {
		btc_address: REGTEST_DATA[329]!.depositAddr,
		btc_network: "regtest",
		sui_network: "testnet",
		nbtc_pkg: "0xPACKAGE",
	};
	nbtcAddressesMap.set(testNbtcAddress.btc_address, testNbtcAddress);

	indexer = new Indexer(
		storage,
		new SuiClient(SUI_CLIENT_CFG),
		nbtcAddressesMap,
		SUI_FALLBACK_ADDRESS,
		networks.regtest,
		8,
		2,
		100,
		mkElectrsServiceMock(), // Pass the service binding
	);
});

afterEach(async () => {
	const db = await mf.getD1Database("DB");
	const tables = ["btc_blocks", "nbtc_minting", "nbtc_withdrawal", "nbtc_sender_deposits"];
	const dropStms = tables.map((t) => `DROP TABLE IF EXISTS ${t};`).join(" ");
	await db.exec(dropStms);
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

async function insertFinalizedTx(
	db: D1Database,
	txData: TxInfo,
	blockData: TestBlock,
	retry_count = 0,
) {
	await db
		.prepare(
			"INSERT INTO nbtc_minting (tx_id, vout, block_hash, block_height, sui_recipient, amount_sats, status, created_at, updated_at, retry_count, nbtc_pkg, sui_network) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
		.bind(
			txData.id,
			0,
			blockData.hash,
			blockData.height,
			txData.suiAddr,
			txData.amountSats,
			"finalized",
			Date.now(),
			Date.now(),
			retry_count,
			"0xPACKAGE",
			"testnet",
		)
		.run();
}

describe("Indexer.findNbtcDeposits", () => {
	it("should correctly parse a single deposit from a real regtest transaction", () => {
		const block = Block.fromHex(REGTEST_DATA[329]!.rawBlockHex);
		const targetTx = block.transactions?.find(
			(tx) => tx.getId() === REGTEST_DATA[329]!.txs[1]!.id,
		);

		expect(targetTx).toBeDefined();

		const deposits = indexer.findNbtcDeposits(targetTx!);
		expect(deposits.length).toEqual(1);
		expect(deposits[0]!.amountSats).toEqual(REGTEST_DATA[329]!.txs[1]!.amountSats);
		expect(deposits[0]!.suiRecipient).toEqual(REGTEST_DATA[329]!.txs[1]!.suiAddr);
		expect(deposits[0]!.vout).toEqual(0);
	});
	it("should find multiple deposits within a single block containing multiple transactions", () => {
		const block = Block.fromHex(REGTEST_DATA[327]!.rawBlockHex);
		expect(block.transactions).toBeDefined();

		const deposits: Deposit[][] = [];
		for (const tx of block.transactions!) {
			const d = indexer.findNbtcDeposits(tx);
			if (d.length > 0)
				// coinbase, nbtc_deposit_1, nbtc_deposit_2, other_tx
				deposits.push(d);
		}

		expect(deposits.length).toEqual(2);
		// TX_1
		expect(deposits[0]![0]!.suiRecipient).toEqual(REGTEST_DATA[327]!.txs[1]!.suiAddr);
		expect(deposits[0]![0]!.amountSats).toEqual(REGTEST_DATA[327]!.txs[1]!.amountSats);
		// TX 2
		expect(deposits[1]![0]!.suiRecipient).toEqual(REGTEST_DATA[327]!.txs[2]!.suiAddr);
		expect(deposits[1]![0]!.amountSats).toEqual(REGTEST_DATA[327]!.txs[2]!.amountSats);
	});
});

describe.skip("Indexer.scanNewBlocks", () => {
	it("should be tested later", () => {
		// TODO: add a test for the scanNewBlocks using the same data
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

describe("Indexer.handleReorgs", () => {
	it("should do nothing if no reorg", async () => {
		const pendingTx = { tx_id: "tx1", block_hash: "hash_A", block_height: 100 };
		const db = await mf.getD1Database("DB");
		await db
			.prepare(
				"INSERT INTO btc_blocks (height, hash, processed_at, status) VALUES (?, ?, ?, ?)",
			)
			.bind(100, "hash_A", Date.now(), "scanned")
			.run();

		const { reorgedTxIds } = await indexer.handleReorgs([pendingTx]);
		expect(reorgedTxIds.length).toEqual(0);
	});

	it("should generate a reset statement if reorg detected", async () => {
		const pendingTx = { tx_id: "tx1", block_hash: "hash_A", block_height: 100 };
		const db = await mf.getD1Database("DB");
		await db
			.prepare(
				"INSERT INTO btc_blocks (height, hash, processed_at, status) VALUES (?, ?, ?, ?)",
			)
			.bind(100, "hash_A_reorged", Date.now(), "scanned")
			.run();
		const { reorgedTxIds } = await indexer.handleReorgs([pendingTx]);
		expect(reorgedTxIds.length).toEqual(1);
	});
});

describe("Indexer.findFinalizedTxs", () => {
	it("should generate a finalize statement when enough confirmations", () => {
		const pendingTx = { tx_id: "tx1", block_hash: null, block_height: 100 };
		const latestHeight = 107;
		const updates = indexer.selectFinalizedNbtcTxs([pendingTx], latestHeight);
		expect(updates.length).toEqual(1);
	});

	it("should do nothing when not enough confirmations", () => {
		const pendingTx = { tx_id: "tx1", block_hash: null, block_height: 100 };
		const latestHeight = 106;
		const updates = indexer.selectFinalizedNbtcTxs([pendingTx], latestHeight);
		expect(updates.length).toEqual(0);
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
	it("should register a tx with a single deposit", async () => {
		const blockData = REGTEST_DATA[329]!;
		const block = Block.fromHex(blockData.rawBlockHex);
		const targetTx = block.transactions?.find((tx) => tx.getId() === blockData.txs[1]!.id);
		expect(targetTx).toBeDefined();

		const txHex = targetTx!.toHex();
		await indexer.registerBroadcastedNbtcTx(txHex);

		const db = await mf.getD1Database("DB");
		const { results } = await db.prepare("SELECT * FROM nbtc_minting").all();
		expect(results.length).toEqual(1);
		expect(results[0]!.tx_id).toEqual(blockData.txs[1]!.id);
		expect(results[0]!.vout).toEqual(0);
		expect(results[0]!.sui_recipient).toEqual(blockData.txs[1]!.suiAddr);
		expect(results[0]!.amount_sats).toEqual(blockData.txs[1]!.amountSats);
	});

	it("should throw an error for a transaction with no valid deposits", async () => {
		const block = Block.fromHex(REGTEST_DATA[329]!.rawBlockHex);
		expect(block.transactions).toBeDefined();
		// The first tx in a block is coinbase
		const coinbaseTx = block.transactions![0]!;

		expect(indexer.registerBroadcastedNbtcTx(coinbaseTx.toHex())).rejects.toThrow(
			"Transaction does not contain any valid nBTC deposits.",
		);
	});
});

describe("Indexer.processFinalizedTransactions", () => {
	it("should process finalized transactions, group them, and call the SUI batch mint function", async () => {
		const block329 = REGTEST_DATA[329]!;
		const tx329 = block329.txs[1]!;

		const db = await mf.getD1Database("DB");
		await insertFinalizedTx(db, tx329, block329);

		const kv = await mf.getKVNamespace("btc_blocks");
		await kv.put(block329.hash, Buffer.from(block329.rawBlockHex, "hex").buffer);

		const fakeSuiTxDigest = "5fSnS1NCf2bYH39n18aGo41ggd2a7sWEy42533g46T2e";
		const suiClientSpy = vi
			.spyOn(indexer.nbtcClient, "tryMintNbtcBatch")
			.mockResolvedValue(fakeSuiTxDigest);

		await indexer.processFinalizedTransactions();
		expect(suiClientSpy).toHaveBeenCalledTimes(1);

		const { results } = await db
			.prepare("SELECT * FROM nbtc_minting WHERE tx_id = ?")
			.bind(tx329.id)
			.all();
		expect(results.length).toEqual(1);
		expect(results[0]!.sui_tx_id).toEqual(fakeSuiTxDigest);
	});
});

describe("Indexer.processFinalizedTransactions Retry Logic", () => {
	it("should retry a failed tx and succeed", async () => {
		const blockData = REGTEST_DATA[329]!;
		const txData = blockData.txs[1]!;

		const db = await mf.getD1Database("DB");
		await insertFinalizedTx(db, txData, blockData);

		const kv = await mf.getKVNamespace("btc_blocks");
		await kv.put(blockData.hash, Buffer.from(blockData.rawBlockHex, "hex").buffer);

		const fakeSuiTxDigest = "5fSnS1NCf2bYH39n18aGo41ggd2a7sWEy42533g46T2e";
		const suiClientSpy = vi
			.spyOn(indexer.nbtcClient, "tryMintNbtcBatch")
			.mockResolvedValue(fakeSuiTxDigest);

		await indexer.processFinalizedTransactions();

		expect(suiClientSpy).toHaveBeenCalledTimes(1);
		const { results } = await db
			.prepare("SELECT * FROM nbtc_minting WHERE tx_id = ?")
			.bind(txData.id)
			.all();
		expect(results.length).toEqual(1);
		expect(results[0]!.sui_tx_id).toEqual(fakeSuiTxDigest);
	});

	it("should retry a failed tx, fail again, and increment retry_count", async () => {
		const blockData = REGTEST_DATA[329]!;
		const txData = blockData.txs[1]!;

		const db = await mf.getD1Database("DB");
		await insertFinalizedTx(db, txData, blockData, 1);

		const kv = await mf.getKVNamespace("btc_blocks");
		await kv.put(blockData.hash, Buffer.from(blockData.rawBlockHex, "hex").buffer);

		const suiClientSpy = vi
			.spyOn(indexer.nbtcClient, "tryMintNbtcBatch")
			.mockResolvedValue(null);

		await indexer.processFinalizedTransactions();

		expect(suiClientSpy).toHaveBeenCalledTimes(1);
		const { results } = await db
			.prepare("SELECT * FROM nbtc_minting WHERE tx_id = ?")
			.bind(txData.id)
			.all();
		expect(results.length).toEqual(1);
		expect(results[0]!.retry_count).toEqual(2);
	});
});

describe("Indexer.detectMintedReorgs", () => {
	it("should detect deep reorg on minted transaction and update status to MINTED_REORG", async () => {
		const blockData = REGTEST_DATA[329]!;
		const txData = blockData.txs[1]!;

		const db = await mf.getD1Database("DB");

		await db
			.prepare(
				"INSERT INTO nbtc_minting (tx_id, vout, block_hash, block_height, sui_recipient, amount_sats, status, created_at, updated_at, retry_count, nbtc_pkg, sui_network) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			)
			.bind(
				txData.id,
				0,
				blockData.hash,
				blockData.height,
				txData.suiAddr,
				txData.amountSats,
				"minted",
				Date.now(),
				Date.now(),
				0,
				"0xPACKAGE",
				"testnet",
			)
			.run();

		const kv = await mf.getKVNamespace("btc_blocks");
		const differentBlock = REGTEST_DATA[327]!;
		await kv.put(blockData.hash, Buffer.from(differentBlock.rawBlockHex, "hex").buffer);

		await indexer.detectMintedReorgs();

		const { results } = await db
			.prepare("SELECT * FROM nbtc_minting WHERE tx_id = ?")
			.bind(txData.id)
			.all();
		expect(results.length).toEqual(1);
		expect(results[0]!.status).toEqual("minted-reorg");
	});

	it("should not update status if minted transaction is still in block", async () => {
		const blockData = REGTEST_DATA[329]!;
		const txData = blockData.txs[1]!;

		const db = await mf.getD1Database("DB");

		await db
			.prepare(
				"INSERT INTO nbtc_minting (tx_id, vout, block_hash, block_height, sui_recipient, amount_sats, status, created_at, updated_at, retry_count, nbtc_pkg, sui_network) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			)
			.bind(
				txData.id,
				0,
				blockData.hash,
				blockData.height,
				txData.suiAddr,
				txData.amountSats,
				"minted",
				Date.now(),
				Date.now(),
				0,
				"0xPACKAGE",
				"testnet",
			)
			.run();

		const kv = await mf.getKVNamespace("btc_blocks");
		await kv.put(blockData.hash, Buffer.from(blockData.rawBlockHex, "hex").buffer);

		await indexer.detectMintedReorgs();

		const { results } = await db
			.prepare("SELECT * FROM nbtc_minting WHERE tx_id = ?")
			.bind(txData.id)
			.all();
		expect(results.length).toEqual(1);
		expect(results[0]!.status).toEqual("minted");
	});
});

describe("getSenderInsertStmts logic", () => {
	it("should fetch sender addresses and store them when scanning a block", async () => {
		const blockData = REGTEST_DATA[329]!;

		const db = await mf.getD1Database("DB");
		await db
			.prepare(
				"INSERT INTO btc_blocks (height, hash, processed_at, status) VALUES (?, ?, ?, ?)",
			)
			.bind(blockData.height, blockData.hash, Date.now(), "new")
			.run();

		const kv = await mf.getKVNamespace("btc_blocks");
		await kv.put(blockData.hash, Buffer.from(blockData.rawBlockHex, "hex").buffer);

		const fakeSenderAddress = "bc1qtestsenderaddress";
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(indexer.electrs.getTx as any).mockResolvedValue(
			new Response(
				JSON.stringify({
					vout: [{ scriptpubkey_address: fakeSenderAddress }],
				}),
			),
		);

		await indexer.scanNewBlocks();

		const block = Block.fromHex(blockData.rawBlockHex);
		const targetTx = block.transactions![1]!;
		const prevTxId = Buffer.from(targetTx.ins[0]!.hash).reverse().toString("hex");

		// Check that the service binding fetch was called with the right request
		expect(indexer.electrs.getTx).toHaveBeenCalledTimes(1);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const requestArg = (indexer.electrs.getTx as any).mock.calls[0][0];
		expect(requestArg).toEqual(prevTxId);

		const { results: mintingResults } = await db.prepare("SELECT * FROM nbtc_minting").all();
		expect(mintingResults.length).toEqual(1);

		const { results: senderResults } = await db
			.prepare("SELECT * FROM nbtc_sender_deposits")
			.all();
		expect(senderResults.length).toEqual(1);
		expect(senderResults[0]!.sender).toEqual(fakeSenderAddress);
	});
});
