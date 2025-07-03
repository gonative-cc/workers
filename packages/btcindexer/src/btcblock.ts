export interface Tx {
	id: string;

	raw: Uint8Array; // raw tx bytes
}

interface Block {
	id: string;
	txs: Tx[];

	// should not be serialized to JSON
	raw: Uint8Array; // raw block bytes
}

export function parseBlocks(body: ReadableStream | null): Block[] {
	// TODO: use msgPack or the default Bitcoin serializer
	console.log('parsing blocks', body);
	return [];
}

export { Block, Transaction, } from 'bitcoinjs-lib';
