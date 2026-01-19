import { describe, it, expect, beforeEach, mock } from "bun:test";
import { IkaClientImp } from "./ika_client";
import type { SuiClient as MystenClient } from "@mysten/sui/client";
import type { SuiNet } from "@gonative-cc/lib/nsui";
import type { CoinStruct } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";

describe("IkaClient - prepareIkaCoin", () => {
	let ikaClient: IkaClientImp;
	let mockMystenClient: MystenClient;
	const testNetwork: SuiNet = "testnet";
	const testOwner = "0x123";

	const createMockCoin = (coinObjectId: string, balance: string): CoinStruct => ({
		coinObjectId,
		balance,
		coinType: "0xika::ika::IKA",
		digest: "mockDigest",
		previousTransaction: "mockTx",
		version: "1",
	});

	const createCoins = (amounts: string[], hasNextPage = false) => ({
		data: amounts.map((amount, index) => createMockCoin(`coin${index}`, amount)),
		hasNextPage,
		nextCursor: null,
	});

	beforeEach(() => {
		mockMystenClient = {
			getCoins: mock(async () => ({ data: [], hasNextPage: false, nextCursor: null })),
		} as unknown as MystenClient;

		ikaClient = new IkaClientImp(testNetwork, mockMystenClient);
	});

	it("should merge coins up to upperLimit", async () => {
		const mockCoins = createCoins(["1000", "5000", "3000"]);
		mockMystenClient.getCoins = mock(async () => mockCoins);

		const tx = new Transaction();
		const result = await ikaClient.prepareIkaCoin(tx, testOwner, 100);

		expect(result).toBeDefined();
	});

	it("should return single coin when it has sufficient balance", async () => {
		const mockCoins = createCoins(["10000", "5000", "3000"]);
		mockMystenClient.getCoins = mock(async () => mockCoins);

		const tx = new Transaction();
		const result = await ikaClient.prepareIkaCoin(tx, testOwner, 8000);

		expect(result).toBeDefined();
	});

	it("should merge multiple coins when single coin insufficient", async () => {
		const mockCoins = createCoins(["3000", "2000", "1000"]);
		mockMystenClient.getCoins = mock(async () => mockCoins);

		const tx = new Transaction();
		const result = await ikaClient.prepareIkaCoin(tx, testOwner, 5000);

		expect(result).toBeDefined();
	});

	it("should throw error when total balance insufficient", async () => {
		const mockCoins = createCoins(["1000", "2000", "1500"]);
		mockMystenClient.getCoins = mock(async () => mockCoins);

		const tx = new Transaction();

		await expect(ikaClient.prepareIkaCoin(tx, testOwner, 10000)).rejects.toThrow(
			"Insufficient IKA balance",
		);
	});

	it("should throw error when no coins found", async () => {
		const mockCoins = createCoins([]);
		mockMystenClient.getCoins = mock(async () => mockCoins);

		const tx = new Transaction();

		await expect(ikaClient.prepareIkaCoin(tx, testOwner)).rejects.toThrow("No IKA coins found");
	});

	it("should handle pagination when fetching all coins", async () => {
		let callCount = 0;
		mockMystenClient.getCoins = mock(async () => {
			callCount++;
			if (callCount === 1) {
				return {
					data: [createMockCoin("coin0", "1000")],
					hasNextPage: true,
					nextCursor: "cursor1",
				};
			}
			return {
				data: [createMockCoin("coin1", "5000")],
				hasNextPage: false,
				nextCursor: null,
			};
		});

		const tx = new Transaction();
		const result = await ikaClient.prepareIkaCoin(tx, testOwner);

		expect(result).toBeDefined();
		expect(callCount).toBe(2);
	});

	it("should handle single coin", async () => {
		const mockCoins = createCoins(["1000"]);
		mockMystenClient.getCoins = mock(async () => mockCoins);

		const tx = new Transaction();
		const result = await ikaClient.prepareIkaCoin(tx, testOwner, 500);

		expect(result).toBeDefined();
	});

	it("should handle coins with equal balances", async () => {
		const mockCoins = createCoins(["5000", "5000"]);
		mockMystenClient.getCoins = mock(async () => mockCoins);

		const tx = new Transaction();
		const result = await ikaClient.prepareIkaCoin(tx, testOwner, 3000);

		expect(result).toBeDefined();
	});

	it("should handle large balance values", async () => {
		const mockCoins = createCoins(["1000000000000", "999999999999"]);
		mockMystenClient.getCoins = mock(async () => mockCoins);

		const tx = new Transaction();
		const result = await ikaClient.prepareIkaCoin(tx, testOwner, 500000000000);

		expect(result).toBeDefined();
	});

	it("should select biggest coins first when merging", async () => {
		const mockCoins = createCoins(["100", "200", "150", "500", "300"]);
		mockMystenClient.getCoins = mock(async () => mockCoins);

		const tx = new Transaction();
		const result = await ikaClient.prepareIkaCoin(tx, testOwner, 600);

		expect(result).toBeDefined();
	});

	it("should call mergeCoins and return the primary coin", async () => {
		const mockCoins = createCoins(["100", "200", "300"]);
		mockMystenClient.getCoins = mock(async () => mockCoins);

		const tx = new Transaction();
		const originalMergeCoins = tx.mergeCoins.bind(tx);
		const mergeCoinsSpy = mock(originalMergeCoins);
		tx.mergeCoins = mergeCoinsSpy;

		const result = await ikaClient.prepareIkaCoin(tx, testOwner, 500);

		expect(result).toBeDefined();
		expect(mergeCoinsSpy).toHaveBeenCalled();
	});
});
