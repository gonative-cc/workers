import { Block } from 'bitcoinjs-lib';

export interface ExtBlock extends Block {
	raw: Buffer;
}

async function streamToBuffer(body: ReadableStream | null): Promise<Buffer> {
	if (!body) {
		return Buffer.alloc(0);
	}

	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
	}

	return Buffer.concat(chunks);
}

function parseBlocksFromBuffer(buffer: Buffer): ExtendedBlock[] {
	const blocks: ExtendedBlock[] = [];
	let parseOffset = 0;

	while (parseOffset < buffer.length) {
		const remainingBuffer = buffer.subarray(parseOffset);
		try {
			const block = Block.fromBuffer(remainingBuffer);
			const blockByteLength = block.byteLength();
			const rawBlockBuffer = remainingBuffer.subarray(0, blockByteLength);
			const extendedBlock = block as ExtendedBlock;
			extendedBlock.raw = rawBlockBuffer;
			blocks.push(extendedBlock);
			parseOffset += blockByteLength;
		} catch (e) {
			// on an invalid block we stop parsing, log the error and break the loop returning the already parsed blocks
			console.error(
				`Failed to parse an invalid bitcoin block at offset ${parseOffset}. ` +
					`Returning ${blocks.length} successfully parsed blocks:`,
				e
			);
			break;
		}
	}
	return blocks;
}

/**
 * parseBlocksFromStream() reads the body stream and parses it.
 * @param body The ReadableStream from the request.
 * @returns A promise that resolves to an array of successfully parsed ExtendedBlock's.
 */
export async function parseBlocksFromStream(body: ReadableStream | null): Promise<ExtendedBlock[]> {
	const fullBuffer = await streamToBuffer(body);
	if (fullBuffer.length === 0) {
		return [];
	}
	return parseBlocksFromBuffer(fullBuffer);
}

export type { Block, Transaction, TxInput, TxOutput } from 'bitcoinjs-lib';
