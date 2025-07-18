import { describe, it, assert, vi } from "vitest";
import { Deposit, Indexer, ProofResult } from "../src/btcindexer";
import { Block, networks, Transaction } from "bitcoinjs-lib";
import { MerkleTree } from "merkletreejs";
import SHA256 from "crypto-js/sha256";
import { SuiClient, SuiClientCfg } from "./sui_client";

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
	303: {
		depositAddr: "bcrt1qfnyeg7dd5vqs2mtc4rekwm8mgpxkj647p39zhw",
		height: 303,
		hash: "39d7c49ae129865f3aca615bc222b185fdff0ff61385b838bbbf00da8cbbea9d",
		rawBlockHex:
			"000000305c2f30d99ad69f247638613dcca7f455159e252878ea6fe10bbc4574a0076914d98ada655d950ac6507d14584fa679d12fb5203c384e52ef292d063fe29b1b645c4b6d68ffff7f200200000002020000000001010000000000000000000000000000000000000000000000000000000000000000ffffffff04022f0100ffffffff02de82814a0000000016001477174bfb906c0e52d750eac4b40fd86746ad50550000000000000000266a24aa21a9ed27611410788b35b819e10a0227f40f9bbc70df824e3a30879552f004b48451210120000000000000000000000000000000000000000000000000000000000000000000000000020000000001017fec0755f3524b89ad45383343f992a0d5cb797a695b59e30f2fc80794f001050000000000fdffffff032202089200000000160014b125723e78c2d779e3e299dfd95d72e9a067a0b780f0fa02000000001600144cc99479ada301056d78a8f3676cfb404d696abe00000000000000000d6a0b3078313233343536373839024730440220755610ff6b6fdea530c20d11b7765816beb75e16ce78fa200a7da25e251a7eb9022078e78bed1cc38822cd5dce3982e23c3cd401415ae72050b00c5f8b3441a2c178012103ef55b72bddf4960ddbb12a9a04f61f91fb613aa99b472115f25a5f8686e6c3f200000000",
		txs: {
			1: {
				id: "2060dfd3cdbffb7db6c968357f3c9df91b52a4cef5c02fad0b0836b0f25cc4ca",
				suiAddr: "0x123456789",
				amountSats: 50000000,
			},
		},
	},
	304: {
		depositAddr: "bcrt1qfnyeg7dd5vqs2mtc4rekwm8mgpxkj647p39zhw",
		height: 304,
		hash: "16495eb0567889ff5b46508c28048324a50815b37c9ea3a85b1ed58f63bc230e",
		rawBlockHex:
			"000000309deabb8cda00bfbb38b88513f60ffffd85b122c25b61ca3a5f8629e19ac4d73967f7061d981ef4da35fc2e880d2404a1454737ec15b35c92793639c402d5a97f53dc7468ffff7f200000000004020000000001010000000000000000000000000000000000000000000000000000000000000000ffffffff0402300100ffffffff02be8e814a0000000016001477174bfb906c0e52d750eac4b40fd86746ad50550000000000000000266a24aa21a9ed576193c3b6e21570e07ea1a4d53ae2bd3414fabed440b1aecd1c054892b3ac9a012000000000000000000000000000000000000000000000000000000000000000000000000002000000000101cac45cf2b036080bad2fc0f5cea4521bf99d3c7f3568c9b67dfbbfcdd3df60200100000000fdffffff0380969800000000001600144cc99479ada301056d78a8f3676cfb404d696abe00000000000000000d6a0b3078313233343536373839a25362020000000016001421fb0b79c3c441c067ce904c382524a194753615024730440220095ebb705f6a02717c6b47899c6ee46bc19ebf2ae41560f21afa5d64427ee41602201bff5431e300fb1eee26826513f049b9305cff58cc1e9e052c644998d0431ef901210337098b94be64f10607235469a877be9bdf472b14edc091ed922d991564ce231900000000020000000001016c365ffde565845a3a89da2d81349a48dd15bc170f84722ff7145ac76e4923210000000000fdffffff02fe2f399300000000160014a0c6c0d56d454bba7fed4c3665203393ad0b91c180c3c901000000001600145a613219e36f111f80fc5a62eee69bc9510c9bf00247304402205e95c4563d35b97d49358b554a4abe6c7ae8470f00587bd838c78c60b7bbc3830220621598ae5ddf10d98dd19f2e3d449ce08a34c5be3f81205dbd4b6bfb549e4034012103ef55b72bddf4960ddbb12a9a04f61f91fb613aa99b472115f25a5f8686e6c3f20000000002000000000101cac45cf2b036080bad2fc0f5cea4521bf99d3c7f3568c9b67dfbbfcdd3df60200000000000fdffffff03002d3101000000001600144cc99479ada301056d78a8f3676cfb404d696abec4ced69000000000160014bc2b8b45fab16600813f446fc9e5993366cdd20800000000000000000d6a0b307839383736353433323102473044022020ce7e33a1d4eba464afec8e32b19a9f9bced2b708749276ab1d0579079f28100220340a8923bac224a2459dcbbbf6052ab5b0b901cb6d9a34fefa9401f1b41b9e410121031a2f0aa2c49472ed301e6332d757f62d99af2221315d53ac9d00d6dcbfdd574400000000",
		txs: {
			1: {
				id: "c7cdf5b0a2a944c6158760d434c954fd38071334971aec33c2662d10a6df0f15",
				suiAddr: "0x123456789",
				amountSats: 10000000,
			},
			2: {
				id: "9408d760c88a3b5a65020b826110f87f9208fb15ffd8e08b27fb6faf50df54fa",
				suiAddr: "0x987654321",
				amountSats: 20000000,
			},
		},
	},
};

const SUI_FALLBACK_ADDRESS = "0xFALLBACK";

const createMockStmt = () => ({
	bind: vi.fn().mockReturnThis(),
});

function mkMockD1() {
	return {
		prepare: vi.fn().mockImplementation(() => createMockStmt()),
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
	const indexer = new Indexer(
		mockEnv,
		REGTEST_DATA[303].depositAddr,
		SUI_FALLBACK_ADDRESS,
		networks.regtest,
		new SuiClient(SUI_CLIENT_CFG),
	);
	return { mockEnv, indexer };
}

function checkTxProof(
	proofResult: ProofResult | null,
	targetTx: Transaction,
	block: Block,
	expected: boolean,
) {
	assert(proofResult);
	assert(block.merkleRoot);

	const expectedRootBigEndian = Buffer.from(block.merkleRoot).reverse().toString("hex");
	assert.equal(
		proofResult.merkleRoot,
		expectedRootBigEndian,
		"Generated Merkle root should match the block header",
	);

	const isProofValid = MerkleTree.verify(
		proofResult.proofPath,
		Buffer.from(targetTx.getHash()).reverse(), // target leaf must be big-endian
		Buffer.from(proofResult.merkleRoot, "hex"),
		SHA256,
		{ isBitcoinTree: true },
	);
	assert.equal(isProofValid, expected);
}

describe("Indexer.findNbtcDeposits", () => {
	const indexer = prepareIndexer().indexer;
	it("should correctly parse a single deposit from a real regtest transaction", () => {
		const block = Block.fromHex(REGTEST_DATA[303].rawBlockHex);
		const targetTx = block.transactions?.find(
			(tx) => tx.getId() === REGTEST_DATA[303].txs[1].id,
		);

		assert(targetTx, "Setup error");

		const deposits = indexer.findNbtcDeposits(targetTx);
		assert.equal(deposits.length, 1);
		assert.equal(deposits[0].amountSats, REGTEST_DATA[303].txs[1].amountSats);
		assert.equal(deposits[0].suiRecipient, REGTEST_DATA[303].txs[1].suiAddr);
		assert.equal(deposits[0].vout, 1);
	});
	it("should find multiple deposits within a single block containing multiple transactions", () => {
		const block = Block.fromHex(REGTEST_DATA[304].rawBlockHex);
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
		assert.equal(deposits[0][0].suiRecipient, REGTEST_DATA[304].txs[1].suiAddr);
		assert.equal(deposits[0][0].amountSats, REGTEST_DATA[304].txs[1].amountSats);
		// TX 2
		assert.equal(deposits[1][0].suiRecipient, REGTEST_DATA[304].txs[2].suiAddr);
		assert.equal(deposits[1][0].amountSats, REGTEST_DATA[304].txs[2].amountSats);
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
		const block = Block.fromHex(REGTEST_DATA[303].rawBlockHex);
		const targetTx = block.transactions?.find(
			(tx) => tx.getId() === REGTEST_DATA[303].txs[1].id,
		);
		assert(targetTx);

		const tree = indexer.constructMerkleTree(block);
		assert(tree);
		const proofResult = indexer.getTxProof(tree, targetTx);
		checkTxProof(proofResult, targetTx, block, true);
	});

	it("should generate a valid proof for a block with an odd number of transactions (3 txs)", () => {
		const block = Block.fromHex(REGTEST_DATA[304].rawBlockHex);
		const targetTx = block.transactions?.find(
			(tx) => tx.getId() === REGTEST_DATA[304].txs[2].id,
		);

		assert(targetTx);

		const tree = indexer.constructMerkleTree(block);
		assert(tree);
		const proofResult = indexer.getTxProof(tree, targetTx);
		checkTxProof(proofResult, targetTx, block, true);
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
