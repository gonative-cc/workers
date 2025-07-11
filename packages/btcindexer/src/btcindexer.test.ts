import { describe, it, assert } from "vitest";
import { Indexer } from "../src/btcindexer";
import { Block, networks } from "bitcoinjs-lib";
import { MerkleTree } from "merkletreejs";
import SHA256 from "crypto-js/sha256";

// generated using bitcoin-cli --regtest
const REGTEST_DATA = {
	DEPOSIT_ADDR: "bcrt1qfnyeg7dd5vqs2mtc4rekwm8mgpxkj647p39zhw",
	SUI_ADDR: "0x123456789",
	BLOCK_HEIGHT: 303,
	BLOCK_ID: "39d7c49ae129865f3aca615bc222b185fdff0ff61385b838bbbf00da8cbbea9d",
	TX_ID: "2060dfd3cdbffb7db6c968357f3c9df91b52a4cef5c02fad0b0836b0f25cc4ca",
	DEPOSIT_AMOUNT_SATS: 50000000,
	RAW_BLOCK_HEX:
		"000000305c2f30d99ad69f247638613dcca7f455159e252878ea6fe10bbc4574a0076914d98ada655d950ac6507d14584fa679d12fb5203c384e52ef292d063fe29b1b645c4b6d68ffff7f200200000002020000000001010000000000000000000000000000000000000000000000000000000000000000ffffffff04022f0100ffffffff02de82814a0000000016001477174bfb906c0e52d750eac4b40fd86746ad50550000000000000000266a24aa21a9ed27611410788b35b819e10a0227f40f9bbc70df824e3a30879552f004b48451210120000000000000000000000000000000000000000000000000000000000000000000000000020000000001017fec0755f3524b89ad45383343f992a0d5cb797a695b59e30f2fc80794f001050000000000fdffffff032202089200000000160014b125723e78c2d779e3e299dfd95d72e9a067a0b780f0fa02000000001600144cc99479ada301056d78a8f3676cfb404d696abe00000000000000000d6a0b3078313233343536373839024730440220755610ff6b6fdea530c20d11b7765816beb75e16ce78fa200a7da25e251a7eb9022078e78bed1cc38822cd5dce3982e23c3cd401415ae72050b00c5f8b3441a2c178012103ef55b72bddf4960ddbb12a9a04f61f91fb613aa99b472115f25a5f8686e6c3f200000000",
};
const SUI_FALLBACK_ADDRESS = "0xFALLBACK";

const mkMockEnv = () => ({
	DB: {} as D1Database,
	btc_blocks: {} as KVNamespace,
	nbtc_txs: {} as KVNamespace,
});

describe("Indexer.findNbtcDeposits", () => {
	it("should correctly parse the real regtest transaction", () => {
		const mockEnv = mkMockEnv();
		const indexer = new Indexer(
			mockEnv,
			REGTEST_DATA.DEPOSIT_ADDR,
			SUI_FALLBACK_ADDRESS,
			networks.regtest,
		);

		const block = Block.fromHex(REGTEST_DATA.RAW_BLOCK_HEX);
		const targetTx = block.transactions?.find((tx) => tx.getId() === REGTEST_DATA.TX_ID);

		assert(targetTx, "Setup error");

		const deposits = indexer.findNbtcDeposits(targetTx);
		assert.equal(deposits.length, 1);
		assert.equal(deposits[0].amountSats, REGTEST_DATA.DEPOSIT_AMOUNT_SATS);
		assert.equal(deposits[0].suiRecipient, REGTEST_DATA.SUI_ADDR);
		assert.equal(deposits[0].vout, 1);
	});
});

describe.skip("Indexer.scanNewBlocks", () => {
	it("should be tested later", () => {
		// TODO: add a test for the scanNewBlocks using the same data
	});
});

describe("Indexer.constructMerkleProof", () => {
	it("should generate a valid proof for a real regtest transaction", () => {
		const mockEnv = mkMockEnv();
		const indexer = new Indexer(
			mockEnv,
			REGTEST_DATA.DEPOSIT_ADDR,
			SUI_FALLBACK_ADDRESS,
			networks.regtest,
		);

		const block = Block.fromHex(REGTEST_DATA.RAW_BLOCK_HEX);
		const targetTx = block.transactions?.find((tx) => tx.getId() === REGTEST_DATA.TX_ID);
		assert(targetTx);

		const proofResult = indexer.constructMerkleProof(block, targetTx);
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
		assert.equal(isProofValid, true);
	});
	it.skip("should generate a valid proof for a tx in a block with more than 1 tx", () => {
		// TODO:
	});
});
