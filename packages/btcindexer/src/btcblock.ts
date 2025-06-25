import { Block } from 'bitcoinjs-lib';

export interface ExtendedBlock extends Block {
	raw: Buffer;
}

export async function parseBlocks(body: ReadableStream | null): Promise<ExtendedBlock[]> {
	if (!body) {
		return [];
	}

	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let totalLen = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		totalLen += value.length;
	}

	const fullBuffer = new Uint8Array(totalLen);
	let bufferOffset = 0;
	for (const chunk of chunks) {
		fullBuffer.set(chunk, bufferOffset);
		bufferOffset += chunk.length;
	}

	const nodeBuffer = Buffer.from(fullBuffer);

	const blocks: ExtendedBlock[] = [];
	let parseOffset = 0;
	while (parseOffset < nodeBuffer.length) {
		try {
			const block = Block.fromBuffer(nodeBuffer.subarray(parseOffset));
			const rawBlockBuffer = nodeBuffer.subarray(0, block.byteLength());
			const extendedBlock = block as ExtendedBlock;
			extendedBlock.raw = rawBlockBuffer;
			blocks.push(extendedBlock);
			parseOffset += block.byteLength();
		} catch (e) {
			console.error('Failed to parse Bitcoin block', e);
			throw new Error('Invalid block data at offset');
		}
	}
	return blocks;
}

export type { Block, Transaction, TxInput, TxOutput } from 'bitcoinjs-lib';
