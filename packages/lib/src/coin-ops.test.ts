import { describe, test, expect } from "bun:test";
import type { CoinStruct } from "@mysten/sui/client";

import { selectCoins } from "./coin-ops";

const createMockCoin = (coinObjectId: string, balance: number): CoinStruct => ({
	coinObjectId,
	balance: String(balance),
	coinType: "0xika::ika::IKA",
	digest: "mockDigest",
	previousTransaction: "mockTx",
	version: "1",
});

const createCoins = (amounts: number[]) =>
	amounts.map((amount, index) => createMockCoin(`coin${index}`, amount));

describe("selectCoins", () => {
	const createTestCoins = () => createCoins([1000, 5000, 3000]);
	const verify = (result: [CoinStruct[], CoinStruct[]], target: bigint) => {
		expect(result).toBeArrayOfSize(2);
		let sum = 0n;
		for (const c of result[0]) sum += BigInt(c.balance);
		expect(sum).toBe(target);
	};

	test("should select first coin if it's bigger", async () => {
		const coins = createTestCoins();
		const result = selectCoins(coins, 100n);
		expect(result[0]).toBeArrayOfSize(1);
		expect(result[0][0]?.balance).toBe("1000");

		verify(result, 1000n);
	});

	test("should select first coin if it's equal", async () => {
		const coins = createTestCoins();
		const result = selectCoins(coins, 1000n);
		expect(result[0]).toBeArrayOfSize(1);
		expect(result[0][0]?.balance).toBe("1000");
	});

	test("should merge all 2 coins", async () => {
		const coins = createTestCoins();
		const result = selectCoins(coins, 6000n);
		expect(result[0]).toBeArrayOfSize(2);
		verify(result, 6000n);
	});

	test("should merge all 3 coins", async () => {
		const coins = createTestCoins();
		const result = selectCoins(coins, 8000n);
		expect(result[0]).toBeArrayOfSize(3);
		verify(result, 9000n);
	});

	test("should throw error when total balance insufficient", async () => {
		const coins = createTestCoins();
		expect(() => selectCoins(coins, 10000n)).toThrow("Insufficient coins balance");
	});

	test("should throw error when there are no coins", async () => {
		expect(() => selectCoins([], 0n)).toThrow("Zero balance");
	});

	test("should select biggest coins first when merging", async () => {
		const nominals = Array(100).fill(1);
		nominals.push(200);
		const coins = createCoins(nominals);

		const limit = 20;
		const result = selectCoins(coins, 100n, limit);
		expect(result[0].length).toBe(limit + 1);
		expect(result[0][limit]?.balance).toBe("200");
		verify(result, 220n);
	});
});
