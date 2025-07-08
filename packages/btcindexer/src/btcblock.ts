import { Block } from "bitcoinjs-lib";

/**
 * Extends the Block type to include raw Buffer and height
 */
export interface ExtBlock extends Block {
	height: number;
	raw: Buffer;
}

/**
 * Defines the structure of the JSON object we expect from the relayer
 */
interface BlockPayload {
	height: number;
	rawBlockHex: string;
}

async function streamToBlockPayload(body: ReadableStream | null): Promise<BlockPayload[]> {
	if (!body) {
		return [];
	}

	const reader = body.getReader();
	const decoder = new TextDecoder();
	let jsonString = ``;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		jsonString += decoder.decode(value, { stream: true });
	}

	return JSON.parse(jsonString);
}

function parseBlockPayloadEntries(payload: BlockPayload[]): ExtBlock[] {
	const blocks: ExtBlock[] = [];
	for (const entry of payload)
		try {
			const rawBlockBuffer = Buffer.from(entry.rawBlockHex, "hex");
			const block = Block.fromBuffer(rawBlockBuffer);
			const extendedBlock = block as ExtBlock;
			extendedBlock.height = entry.height;
			extendedBlock.raw = rawBlockBuffer;
			blocks.push(extendedBlock);
		} catch (e) {
			// on an invalid block we stop parsing, log the error and break the loop returning the already parsed blocks
			console.error(
				`Failed to parse an invalid bitcoin block at height ${entry.height}. ` +
					`Returning ${blocks.length} successfully parsed blocks:`,
				e,
			);
			break;
		}
	return blocks;
}

/**
 * parseBlocksFromStream() reads the body stream and parses it.
 * @param body The ReadableStream from the request.
 * @returns A promise that resolves to an array of successfully parsed ExtendedBlock's.
 */
export async function parseBlocksFromStream(body: ReadableStream | null): Promise<ExtBlock[]> {
	const payload = await streamToBlockPayload(body);
	if (payload.length === 0) {
		return [];
	}
	return parseBlockPayloadEntries(payload);
}
export { Block, Transaction } from "bitcoinjs-lib";
