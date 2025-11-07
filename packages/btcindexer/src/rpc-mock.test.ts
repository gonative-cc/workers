import { describe, it, expect, beforeEach } from "bun:test";
import { TxStatus } from "./models";
import type { TxStatusResp } from "./models";
import type { PutBlocks as PutBlocksType } from "./api/put-blocks";
import { Block } from "bitcoinjs-lib";
import { BtcIndexerRpcMockBase } from "./rpc-mock-base";

describe("MockBtcIndexerRpc (Logic Tests)", () => {
	let rpc: BtcIndexerRpcMockBase;

	beforeEach(() => {
		// Create a new instance for each test
		rpc = new BtcIndexerRpcMockBase();
	});

	describe("putBlocks", () => {
		it("should store blocks and return count of inserted blocks", async () => {
			// Create mock blocks with the correct structure
			const block1 = Block.fromHex(
				"0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a45068653ffff7f2002000000",
			);
			const block2 = Block.fromHex(
				"0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a45068653ffff7f2003000000",
			);

			const blocks: PutBlocksType[] = [
				{ height: 100, block: block1 },
				{ height: 101, block: block2 },
			];

			const result = await rpc.putBlocks(blocks);
			expect(result).toBe(2);
		});

		it("should not insert duplicate blocks", async () => {
			const block = Block.fromHex(
				"0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a45068653ffff7f2002000000",
			);
			const blocks: PutBlocksType[] = [{ height: 100, block }];

			await rpc.putBlocks(blocks);
			const result = await rpc.putBlocks(blocks);
			expect(result).toBe(0);
		});
	});

	describe("latestHeight", () => {
		it("should return null when no blocks exist", async () => {
			const result = await rpc.latestHeight();
			expect(result).toEqual({ height: null });
		});

		it("should return the highest block height", async () => {
			const block1 = Block.fromHex(
				"0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a45068653ffff7f2002000000",
			);
			const block2 = Block.fromHex(
				"0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a45068653ffff7f2003000000",
			);
			const block3 = Block.fromHex(
				"0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a45068653ffff7f2004000000",
			);

			const blocks: PutBlocksType[] = [
				{ height: 100, block: block1 },
				{ height: 105, block: block2 },
				{ height: 102, block: block3 },
			];

			await rpc.putBlocks(blocks);
			const result = await rpc.latestHeight();
			expect(result).toEqual({ height: 105 });
		});
	});

	describe("putNbtcTx", () => {
		it("should register a valid transaction and return tx_id", async () => {
			// Valid Bitcoin transaction hex (from regtest block 329, tx 1)
			const txHex =
				"020000000001014d169a4e5b94219f8dc7f12492b5b23556d15447d2be7166e78b4028e730e18e0000000000fdffffff0350c30000000000001600144cc99479ada301056d78a8f3676cfb404d696abe1a21fd9400000000160014d9e0684e75b195ed7dcaa869cec83edeea15a8e50000000000000000236a2100bbad40ecca892cf0d54ba0b9c986454be0695ce29642223a02c37e3b87a4499c0247304402205e74c8406c7ce0dc6c0e71fb12e8d49e12af629d91861e35706cb15569c3ad31022051c00b0e1d6d77da4e4bfa31ca0a4b532989e1e4db78f6fe68fd3baf0cd5ede3012103729dbfb24ebf0c9ea58b02b9374aeeb3b42ac05a64cdfffe12db81fdd9c8298300000000";

			const result = await rpc.putNbtcTx(txHex);
			expect(result.tx_id).toBeDefined();
			expect(result.registered_deposits).toBe(1);
		});

		it("should throw error for invalid transaction hex", async () => {
			const invalidHex = "invalid";
			await expect(rpc.putNbtcTx(invalidHex)).rejects.toThrow();
		});
	});

	describe("statusByTxid", () => {
		it("should return null for non-existent transaction", async () => {
			const result = await rpc.statusByTxid("nonexistent");
			expect(result).toBeNull();
		});

		it("should return transaction status after putNbtcTx", async () => {
			const txHex =
				"020000000001014d169a4e5b94219f8dc7f12492b5b23556d15447d2be7166e78b4028e730e18e0000000000fdffffff0350c30000000000001600144cc99479ada301056d78a8f3676cfb404d696abe1a21fd9400000000160014d9e0684e75b195ed7dcaa869cec83edeea15a8e50000000000000000236a2100bbad40ecca892cf0d54ba0b9c986454be0695ce29642223a02c37e3b87a4499c0247304402205e74c8406c7ce0dc6c0e71fb12e8d49e12af629d91861e35706cb15569c3ad31022051c00b0e1d6d77da4e4bfa31ca0a4b532989e1e4db78f6fe68fd3baf0cd5ede3012103729dbfb24ebf0c9ea58b02b9374aeeb3b42ac05a64cdfffe12db81fdd9c8298300000000";

			const { tx_id } = await rpc.putNbtcTx(txHex);
			const status = await rpc.statusByTxid(tx_id);

			expect(status).not.toBeNull();
			expect(status?.btc_tx_id).toBe(tx_id);
			expect(status?.status).toBe(TxStatus.BROADCASTING);
		});
	});

	describe("statusBySuiAddress", () => {
		it("should return empty array for address with no transactions", async () => {
			const result = await rpc.statusBySuiAddress(
				"0x1111111111111111111111111111111111111111111111111111111111111111",
			);
			expect(result).toEqual([]);
		});

		it("should return transactions for a sui address", async () => {
			const suiAddr = "0x1234567890123456789012345678901234567890123456789012345678901234";
			const mockTx: TxStatusResp = {
				btc_tx_id: "txid123",
				status: TxStatus.CONFIRMING,
				block_height: 100,
				confirmations: 3,
				sui_recipient: suiAddr,
				amount_sats: 50000,
				sui_tx_id: null,
			};

			rpc.addMockTransaction(mockTx);
			const result = await rpc.statusBySuiAddress(suiAddr);

			expect(result).toHaveLength(1);
			expect(result[0]?.btc_tx_id).toBe("txid123");
			expect(result[0]?.sui_recipient).toBe(suiAddr);
		});
	});

	describe("depositsBySender", () => {
		it("should return empty array for sender with no deposits", async () => {
			const result = await rpc.depositsBySender("bc1qsenderaddress");
			expect(result).toEqual([]);
		});

		it("should return deposits for a bitcoin sender address", async () => {
			const btcAddr = "bc1qsenderaddress";
			const txid = "txid456";
			const mockTx: TxStatusResp = {
				btc_tx_id: txid,
				status: TxStatus.FINALIZED,
				block_height: 200,
				confirmations: 6,
				sui_recipient: "0xrecipient",
				amount_sats: 100000,
				sui_tx_id: null,
			};

			rpc.addMockTransaction(mockTx);
			rpc.addMockSender(btcAddr, txid);

			const result = await rpc.depositsBySender(btcAddr);

			expect(result).toHaveLength(1);
			expect(result[0]?.btc_tx_id).toBe(txid);
		});
	});

	describe("addMockTransaction helper", () => {
		it("should allow adding mock transactions for testing", async () => {
			const mockTx: TxStatusResp = {
				btc_tx_id: "test_tx",
				status: TxStatus.MINTED,
				block_height: 300,
				confirmations: 10,
				sui_recipient: "0xtest",
				amount_sats: 75000,
				sui_tx_id: "0xsuimint",
			};

			rpc.addMockTransaction(mockTx);
			const result = await rpc.statusByTxid("test_tx");

			expect(result).not.toBeNull();
			expect(result?.status).toBe(TxStatus.MINTED);
			expect(result?.sui_tx_id).toBe("0xsuimint");
		});
	});
});
