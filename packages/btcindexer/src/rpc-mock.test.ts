import { describe, it, expect, beforeEach } from "bun:test";
import { TxStatus } from "./models";
import type { TxStatusResp } from "./models";
import type { PutBlocks as PutBlocksType } from "./api/put-blocks";

// We can't directly import MockBtcIndexerRpc in tests because it depends on
// `cloudflare:workers` module which is only available in the Workers runtime.
// Instead, we'll test the implementation logic in a runtime-agnostic way.

// Mock implementation that mirrors MockBtcIndexerRpc but doesn't extend WorkerEntrypoint
class TestMockRpc {
	#blocks: Map<number, PutBlocksType> = new Map();
	#transactions: Map<string, TxStatusResp> = new Map();
	#transactionsBySuiAddress: Map<string, Set<string>> = new Map();
	#transactionsBySender: Map<string, Set<string>> = new Map();

	async putBlocks(blocks: PutBlocksType[]): Promise<number> {
		let inserted = 0;
		for (const block of blocks) {
			if (!this.#blocks.has(block.height)) {
				this.#blocks.set(block.height, block);
				inserted++;
			}
		}
		return inserted;
	}

	async latestHeight(): Promise<{ height: number | null }> {
		if (this.#blocks.size === 0) {
			return { height: null };
		}
		const heights = Array.from(this.#blocks.keys());
		const maxHeight = Math.max(...heights);
		return { height: maxHeight };
	}

	async putNbtcTx(txHex: string): Promise<{ tx_id: string; registered_deposits: number }> {
		const { Transaction } = await import("bitcoinjs-lib");
		try {
			const tx = Transaction.fromHex(txHex);
			const txid = tx.getId();

			const mockStatus: TxStatusResp = {
				btc_tx_id: txid,
				status: TxStatus.BROADCASTING,
				block_height: null,
				confirmations: 0,
				sui_recipient: "0x0000000000000000000000000000000000000000000000000000000000000000",
				amount_sats: 100000,
				sui_tx_id: null,
			};

			this.#transactions.set(txid, mockStatus);
			return { tx_id: txid, registered_deposits: 1 };
		} catch (error) {
			throw new Error(`Invalid transaction hex: ${error}`);
		}
	}

	async statusByTxid(txid: string): Promise<TxStatusResp | null> {
		return this.#transactions.get(txid) || null;
	}

	async statusBySuiAddress(suiAddress: string): Promise<TxStatusResp[]> {
		const txids = this.#transactionsBySuiAddress.get(suiAddress);
		if (!txids) {
			return [];
		}
		const results: TxStatusResp[] = [];
		for (const txid of txids) {
			const status = this.#transactions.get(txid);
			if (status) {
				results.push(status);
			}
		}
		return results;
	}

	async depositsBySender(address: string): Promise<TxStatusResp[]> {
		const txids = this.#transactionsBySender.get(address);
		if (!txids) {
			return [];
		}
		const results: TxStatusResp[] = [];
		for (const txid of txids) {
			const status = this.#transactions.get(txid);
			if (status) {
				results.push(status);
			}
		}
		return results;
	}

	addMockTransaction(txStatus: TxStatusResp): void {
		this.#transactions.set(txStatus.btc_tx_id, txStatus);
		if (!this.#transactionsBySuiAddress.has(txStatus.sui_recipient)) {
			this.#transactionsBySuiAddress.set(txStatus.sui_recipient, new Set());
		}
		this.#transactionsBySuiAddress.get(txStatus.sui_recipient)!.add(txStatus.btc_tx_id);
	}

	addMockSender(btcAddress: string, txid: string): void {
		if (!this.#transactionsBySender.has(btcAddress)) {
			this.#transactionsBySender.set(btcAddress, new Set());
		}
		this.#transactionsBySender.get(btcAddress)!.add(txid);
	}
}

describe("MockBtcIndexerRpc (Logic Tests)", () => {
	let rpc: TestMockRpc;

	beforeEach(() => {
		// Create a new instance for each test
		rpc = new TestMockRpc();
	});

	describe("putBlocks", () => {
		it("should store blocks and return count of inserted blocks", async () => {
			const blocks: PutBlocksType[] = [
				{ height: 100, hash: "hash100", raw: new Uint8Array([1, 2, 3]) },
				{ height: 101, hash: "hash101", raw: new Uint8Array([4, 5, 6]) },
			];

			const result = await rpc.putBlocks(blocks);
			expect(result).toBe(2);
		});

		it("should not insert duplicate blocks", async () => {
			const blocks: PutBlocksType[] = [
				{ height: 100, hash: "hash100", raw: new Uint8Array([1, 2, 3]) },
			];

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
			const blocks: PutBlocksType[] = [
				{ height: 100, hash: "hash100", raw: new Uint8Array([1, 2, 3]) },
				{ height: 105, hash: "hash105", raw: new Uint8Array([4, 5, 6]) },
				{ height: 102, hash: "hash102", raw: new Uint8Array([7, 8, 9]) },
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
			expect(result[0].btc_tx_id).toBe("txid123");
			expect(result[0].sui_recipient).toBe(suiAddr);
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
			expect(result[0].btc_tx_id).toBe(txid);
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
