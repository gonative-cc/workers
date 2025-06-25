import { describe, it, assert } from 'vitest';
import { parseBlocks } from './btcblock';

function bufferToStream(buffer: Buffer): ReadableStream {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(buffer);
			controller.close();
		},
	});
}

describe('parseBlocks', () => {
	// mainnet genesis block
	const blockHex =
		'0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c0101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000';
	const blockBuffer = Buffer.from(blockHex, 'hex');

	it('should parse a single block from a stream', async () => {
		const stream = bufferToStream(blockBuffer);
		const parsedBlocks = await parseBlocks(stream);

		assert(parsedBlocks.length == 1);
		assert(parsedBlocks[0].getId() == '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f');
		assert(parsedBlocks[0].raw.equals(blockBuffer));
	});

	it('should parse multiple blocks from stream', async () => {
		// for simplicity we concatenate the genesis block with itself
		const concatBuffer = Buffer.concat([blockBuffer, blockBuffer]);
		const stream = bufferToStream(concatBuffer);
		const parsedBlocks = await parseBlocks(stream);

		assert(parsedBlocks.length == 2);
		assert(parsedBlocks[0].getId() == '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f');
		assert(parsedBlocks[1].getId() == '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f');
		assert(parsedBlocks[0].raw.equals(blockBuffer));
	});

	it('should return an empty array for empty stream', async () => {
		const parsedBlocks = await parseBlocks(null);
		assert(parsedBlocks.length == 0);
	});
});
