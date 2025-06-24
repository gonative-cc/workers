export interface Block {
	id: string;
	raw: Uint8Array; // raw block bytes
}

export function parseBlocks(body: ReadableStream | null): Block[] {
	// TODO: use msgPack or the default Bitcoin serializer
	console.log('parsing blocks', body);
	return [];
}
