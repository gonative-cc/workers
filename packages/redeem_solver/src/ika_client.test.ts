import { describe, it, expect, beforeEach, mock } from "bun:test";
import { IkaClientImp } from "./ika_client";
import type { SuiClient as MystenClient } from "@mysten/sui/client";
import type { SuiNet } from "@gonative-cc/lib/nsui";
import type { CoinStruct } from "@mysten/sui/client";

describe("IkaClient - selectIkaCoin", () => {
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

	beforeEach(() => {
		mockMystenClient = {
			getCoins: mock(async () => ({ data: [], hasNextPage: false, nextCursor: null })),
		} as unknown as MystenClient;

		ikaClient = new IkaClientImp(testNetwork, mockMystenClient);
	});

	it("should select the coin with the highest balance", async () => {
		const mockCoins = {
			data: [
				createMockCoin("coin1", "1000"),
				createMockCoin("coin2", "5000"),
				createMockCoin("coin3", "3000"),
			],
			hasNextPage: false,
			nextCursor: null,
		};

		mockMystenClient.getCoins = mock(async () => mockCoins);
		const result = await ikaClient.selectIkaCoin(testOwner);
		expect(result).toBe("coin2");
	});

	it("should handle single coin", async () => {
		const mockCoins = {
			data: [createMockCoin("coin1", "1000")],
			hasNextPage: false,
			nextCursor: null,
		};

		mockMystenClient.getCoins = mock(async () => mockCoins);
		const result = await ikaClient.selectIkaCoin(testOwner);
		expect(result).toBe("coin1");
	});

	it("should throw error when no coins are found", async () => {
		const mockCoins = {
			data: [],
			hasNextPage: false,
			nextCursor: null,
		};

		mockMystenClient.getCoins = mock(async () => mockCoins);
		await expect(ikaClient.selectIkaCoin(testOwner)).rejects.toThrow(
			"No IKA coins found for address",
		);
	});

	it("should handle coins with equal balances", async () => {
		const mockCoins = {
			data: [createMockCoin("coin1", "5000"), createMockCoin("coin2", "5000")],
			hasNextPage: false,
			nextCursor: null,
		};

		mockMystenClient.getCoins = mock(async () => mockCoins);
		const result = await ikaClient.selectIkaCoin(testOwner);
		expect(["coin1", "coin2"]).toContain(result);
	});

	it("should handle large balance values", async () => {
		const mockCoins = {
			data: [
				createMockCoin("coin1", "1000000000000"),
				createMockCoin("coin2", "999999999999"),
			],
			hasNextPage: false,
			nextCursor: null,
		};

		mockMystenClient.getCoins = mock(async () => mockCoins);
		const result = await ikaClient.selectIkaCoin(testOwner);
		expect(result).toBe("coin1");
	});

	it("should select largest among many coins", async () => {
		const mockCoins = {
			data: [
				createMockCoin("coin1", "100"),
				createMockCoin("coin2", "200"),
				createMockCoin("coin3", "150"),
				createMockCoin("coin4", "500"),
				createMockCoin("coin5", "300"),
			],
			hasNextPage: false,
			nextCursor: null,
		};

		mockMystenClient.getCoins = mock(async () => mockCoins);
		const result = await ikaClient.selectIkaCoin(testOwner);
		expect(result).toBe("coin4");
	});
});
