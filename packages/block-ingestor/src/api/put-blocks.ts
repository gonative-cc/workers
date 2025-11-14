import { Block } from "bitcoinjs-lib";
import { pack, unpack } from "msgpackr";
import { BitcoinNetwork } from "@gonative-cc/lib/bitcoin";

export interface PutBlock {
	network: BitcoinNetwork;
	height: number;
	block: Block;
}

export function newPutBlock(network: BitcoinNetwork, height: number, block: Block): PutBlock {
	return { network, height, block };
}

export class PutBlocksReq {
	network: BitcoinNetwork;
	height: number;
	block: Uint8Array;

	constructor(network: BitcoinNetwork, height: number, block: Block) {
		this.network = network;
		this.height = height;
		this.block = block.toBuffer();
	}

	static decode(req: ArrayBuffer | Buffer): PutBlock[] {
		const putReq: PutBlocksReq[] = unpack(new Uint8Array(req));
		return putReq.map((r): PutBlock => {
			return {
				network: r.network,
				height: r.height,
				block: Block.fromBuffer(Buffer.from(r.block)),
			};
		});
	}

	static encode(putBlocks: PutBlock[]): Buffer {
		const req = putBlocks.map((r) => new PutBlocksReq(r.network, r.height, r.block));
		return pack(req);
	}

	// directly encode this struct to msgpack
	static msgpack(putBlocks: PutBlocksReq[]) {
		return pack(putBlocks);
	}
}
