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
): { selected: CoinStruct[]; total: bigint; ok: boolean } {
	const selected: CoinStruct[] = [];
	let total = BigInt(0);
	sortCoinsByBalance(coins);

	for (const coin of coins) {
		selected.push(coin);
		total += BigInt(coin.balance);
		if (total >= target) {
			return { selected, total, ok: true };
		}
	}

	return { selected, total, ok: total >= target };
}

// Select coins from provided coins, such that we can merge them to obtain a target balance.
// @firstLimit: limit the number of coins to select without sorting allCoins. If the target is
//    not reached while picking allCoins[:firstLimit], we sort the remaining coins and keep
//    from the biggest ones until the target is reached.
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
	let selectedTotal = BigInt(0);
	for (const coin of allCoins) {
		if (selected.length === firstLimit) break;

		selected.push(coin);
		selectedTotal += BigInt(coin.balance);
		if (selectedTotal >= target) break;
	}

	if (selectedTotal < target && allCoins.length > selected.length) {
		const selected2 = selectBiggestCoins(
			allCoins.slice(selected.length),
			target - selectedTotal,
		);
		if (!selected2.ok) {
			const available = selectedTotal + selected2.total;
			throw new Error(
				`Insufficient coins balance. Required: ${target}, available: ${available}`,
			);
		}
		selected = selected.concat(selected2.selected);
	} else if (selectedTotal < target) {
		throw new Error(
			`Insufficient coins balance. Required: ${target}, available: ${selectedTotal}`,
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

	// we know that length >=2 because selectCoins which throws an error for empty arrays.
	const [firstCoin, ...coinsToMerge] = selected;
	const preparedCoin = tx.object(firstCoin!.coinObjectId);
	const coinToMergeArgs = coinsToMerge.map((c) => tx.object(c.coinObjectId));

	tx.mergeCoins(preparedCoin, coinToMergeArgs);
	return { preparedCoin, remaining };
}
