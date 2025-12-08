import type { MintBatchArg, SuiTxDigest } from "./models";
import type { SuiClientI } from "./sui_client";
import { jest } from "bun:test";

// MockSuiClient implements SuiClientI for testing purposes
export class MockSuiClient implements SuiClientI {
	verifyBlocks = jest.fn(async (blockHashes: string[]): Promise<boolean[]> => {
		return blockHashes.map(() => true);
	});

	mintNbtcBatch = jest.fn(async (mintArgs: MintBatchArg[]): Promise<[boolean, SuiTxDigest]> => {
		return [true, `fake-sui-tx-digest-batch-${mintArgs.length}`];
	});

	tryMintNbtcBatch = jest.fn(
		async (mintArgs: MintBatchArg[]): Promise<[boolean, SuiTxDigest] | null> => {
			if (mintArgs.length > 0) {
				return [true, `fake-sui-tx-digest-batch-${mintArgs.length}`];
			}
			return null;
		},
	);
}
