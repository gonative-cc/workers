// Module to help with coin operations on Sui

import type { CoinStruct } from "@mysten/sui/client";
import { Transaction, type TransactionObjectArgument } from "@mysten/sui/transactions";

interface HasBalance {
	balance: string;
}

const cmpCoins = (a: HasBalance, b: HasBalance) => {
	const aBalance = BigInt(a.balance);
	const bBalance = BigInt(b.balance);
	return bBalance === aBalance ? 0 : bBalance > aBalance ? 1 : -1;
};

// sorts coins in place
export function sortCoinsByBalance(coins: CoinStruct[]) {
	return coins.sort(cmpCoins);
}

export function selectBiggestCoins(
	coins: CoinStruct[],
	target: bigint,
): { selected: CoinStruct[]; ok: boolean } {
	const selected: CoinStruct[] = [];
	let total = BigInt(0);
	sortCoinsByBalance(coins);

	for (const coin of coins) {
		selected.push(coin);
		total += BigInt(coin.balance);
		if (total >= target) {
			return { selected, ok: true };
		}
	}

	return { selected, ok: total >= target };
}

// Select coins from provided coins, such that we can merge them to obtain a target balance.
// Returns coins to merge and remaining coins.
// Throws an error if the provided coins are empty, or if in total there is no sufficient balance.
// TODO: implement return for the remaing coins.
export function selectCoins(
	allCoins: CoinStruct[],
	target: bigint,
	firstLimit = 80,
): [CoinStruct[], CoinStruct[]] {
	if (!allCoins || allCoins.length === 0) {
		throw new Error("Zero balance");
	}

	let selected: CoinStruct[] = [];
	let totalBalance = BigInt(0);
	for (const coin of allCoins) {
		if (selected.length == firstLimit) break;

		selected.push(coin);
		totalBalance += BigInt(coin.balance);
		if (totalBalance >= target) break;
	}

	if (totalBalance < target && allCoins.length > selected.length) {
		const selected2 = selectBiggestCoins(
			allCoins.slice(selected.length),
			target - totalBalance,
		);
		if (!selected2.ok) {
			throw new Error(
				`Insufficient coins balance. Required: ${target}, available: ${totalBalance}`,
			);
		}
		selected = selected.concat(selected2.selected);
	} else if (totalBalance < target) {
		throw new Error(
			`Insufficient coins balance. Required: ${target}, available: ${totalBalance}`,
		);
	}
	return [selected, []];
}

interface PrepareCoinResult {
	preparedCoin: TransactionObjectArgument;
	remaining: CoinStruct[];
}

export function prepareCoin(
	allCoins: CoinStruct[],
	target: bigint,
	tx: Transaction,
): PrepareCoinResult {
	const [selected, remaining] = selectCoins(allCoins, target);

	if (selected.length === 1) {
		const coin = selected[0]!;
		return { preparedCoin: tx.object(coin.coinObjectId), remaining };
	}

	const [firstCoin, ...coinsToMerge] = selected;
	if (!firstCoin) {
		throw new Error("No primary coin available");
	}
	const preparedCoin = tx.object(firstCoin.coinObjectId);
	const coinToMergeArgs = coinsToMerge.map((c) => tx.object(c.coinObjectId));

	tx.mergeCoins(preparedCoin, coinToMergeArgs);
	return { preparedCoin, remaining };
}
