import { Block } from "bitcoinjs-lib";
import { pack, unpack } from "msgpackr";

export interface PutBlocks {
	height: number;
	block: Block; // bitcoin core encoding of Block
}

export function newPutBlock(height: number, block: Block): PutBlocks {
	return { height, block };
}

export class PutBlocksReq {
	height: number;
	block: Uint8Array; // bitcoin core encoding of Block

	constructor(height: number, block: Block) {
		this.height = height;
		this.block = block.toBuffer();
	}

	static decode(req: ArrayBuffer): PutBlocks[] {
		const putReq: PutBlocksReq[] = unpack(new Uint8Array(req));
		return putReq.map((r): PutBlocks => {
			return { height: r.height, block: Block.fromBuffer(Buffer.from(r.block)) };
		});
	}

	static encode(putBlocks: PutBlocks[]): Buffer {
		const req = putBlocks.map((r) => new PutBlocksReq(r.height, r.block));
		return pack(req);
	}

	// directly encode this struct to msgpack
	static msgpack(putBlocks: PutBlocksReq[]) {
		return pack(putBlocks);
	}
}
