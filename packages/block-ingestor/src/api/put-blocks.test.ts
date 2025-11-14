import { describe, it, expect } from "bun:test";
import { newPutBlock, PutBlocksReq } from "./put-blocks";
import { Block } from "bitcoinjs-lib";
import { BitcoinNetwork } from "@gonative-cc/lib/bitcoin";

function bufferToHex(buffer: Buffer) {
	// Convert to Uint8Array if it's an ArrayBuffer
	const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;

	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

describe("encode PutBlocks", () => {
	// mainnet genesis block
	const blockHex =
		"0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c0101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000";
	const block = Block.fromHex(blockHex);

	it("should decode a single block", async () => {
		expect(block.getId()).toEqual(
			"000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f",
		);

		const expected = [newPutBlock(BitcoinNetwork.MAINNET, 156, block)];
		const reqBytes = PutBlocksReq.encode(expected);

		const got = PutBlocksReq.decode(reqBytes);
		expect(got).toHaveLength(1);

		const pb0 = got[0]!;
		expect(pb0.block.getId()).toEqual(block.getId());
		expect(pb0.height).toEqual(expected[0]!.height);
		expect(pb0.network).toEqual(expected[0]!.network);
		expect(bufferToHex(reqBytes)).toContain(blockHex);
	});

	it("should decode multiple blocks", async () => {
		// for simplicity we encode 2 genesis blocks
		const expected = [
			newPutBlock(BitcoinNetwork.MAINNET, 10, block),
			newPutBlock(BitcoinNetwork.TESTNET, 11, block),
		];
		const reqBytes = PutBlocksReq.encode(expected);
		const got = PutBlocksReq.decode(reqBytes);
		expect(got).toHaveLength(2);
		expect(got).toEqual(expected);
	});

	it("should handle empty array", async () => {
		const reqBytes = PutBlocksReq.encode([]);
		const got = PutBlocksReq.decode(reqBytes);
		expect(got).toEqual([]);
	});

	it("should abort on an invalid block", async () => {
		const pbq = new PutBlocksReq(BitcoinNetwork.REGTEST, 2, block);
		const buffer = Buffer.from("invaliddddd", "utf8");
		pbq.block = new Uint8Array(buffer);
		const reqBytes = PutBlocksReq.msgpack([pbq]);
		expect(() => PutBlocksReq.decode(reqBytes)).toThrow("Buffer too small");
	});
});
