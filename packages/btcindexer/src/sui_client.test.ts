import { describe, it, assert } from "vitest";
import { Indexer } from "./btcindexer";
import { SuiClient, SuiClientCfg } from "./sui_client";
import { Block, networks } from "bitcoinjs-lib";

const REGTEST_DATA = {
	BLOCK_HEX:
		"000000305c2f30d99ad69f247638613dcca7f455159e252878ea6fe10bbc4574a0076914d98ada655d950ac6507d14584fa679d12fb5203c384e52ef292d063fe29b1b645c4b6d68ffff7f200200000002020000000001010000000000000000000000000000000000000000000000000000000000000000ffffffff04022f0100ffffffff02de82814a0000000016001477174bfb906c0e52d750eac4b40fd86746ad50550000000000000000266a24aa21a9ed27611410788b35b819e10a0227f40f9bbc70df824e3a30879552f004b48451210120000000000000000000000000000000000000000000000000000000000000000000000000020000000001017fec0755f3524b89ad45383343f992a0d5cb797a695b59e30f2fc80794f001050000000000fdffffff032202089200000000160014b125723e78c2d779e3e299dfd95d72e9a067a0b780f0fa02000000001600144cc99479ada301056d78a8f3676cfb404d696abe00000000000000000d6a0b3078313233343536373839024730440220755610ff6b6fdea530c20d11b7765816beb75e16ce78fa200a7da25e251a7eb9022078e78bed1cc38822cd5dce3982e23c3cd401415ae72050b00c5f8b3441a2c178012103ef55b72bddf4960ddbb12a9a04f61f91fb613aa99b472115f25a5f8686e6c3f200000000",
	TX_ID: "2060dfd3cdbffb7db6c968357f3c9df91b52a4cef5c02fad0b0836b0f25cc4ca",
	BLOCK_HEIGHT: 303,
};

const SUI_CLIENT_CONFIG: SuiClientCfg = {
	network: "devnet",
	nbtcPkg: "0x7a03af034ade1d5b4072ba4fdb9650bd5ce0cd4dcab40f0563540be0ebbe824b",
	nbtcModule: "indexer_test",
	nbtcObjectId: "0xd93cc7f6d91100990f9fa8ca11d533a69254e2f716ab69a22c6cc4e9a49a9374",
	lightClientObjectId: "0xd93cc7f6d91100990f9fa8ca11d533a69254e2f716ab69a22c6cc4e9a49a9374",
	signerMnemonic:
		"your mnemonic your mnemonic your mnemonic your mnemonic your mnemonic your mnemonic",
};

// NOTE: skip to prevent this test from running in CI
describe.skip("Sui Contract Integration", () => {
	it("should successfully call the mint function on devnet", { timeout: 60000 }, async () => {
		const suiClient = new SuiClient(SUI_CLIENT_CONFIG);
		const indexer = new Indexer(
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			{} as any,
			suiClient,
			"bcrt1qfnyeg7dd5vqs2mtc4rekwm8mgpxkj647p39zhw",
			"fallback",
			networks.regtest,
		);
		const block = Block.fromHex(REGTEST_DATA.BLOCK_HEX);
		const txIndex = block.transactions?.findIndex((tx) => tx.getId() === REGTEST_DATA.TX_ID);
		assert(txIndex);
		const targetTx = block.transactions?.[txIndex ?? -1];
		assert(targetTx);

		const tree = indexer.constructMerkleTree(block);
		assert(tree);
		const proofPath = indexer.getTxProof(tree, targetTx);
		assert(proofPath);
		const calculatedRoot = tree.getRoot();

		const success = await suiClient.tryMintNbtc(targetTx, REGTEST_DATA.BLOCK_HEIGHT, txIndex, {
			proofPath,
			merkleRoot: calculatedRoot.toString("hex"),
		});
		assert.isTrue(success);
	});
});
