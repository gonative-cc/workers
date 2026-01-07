import { Transaction } from "bitcoinjs-lib";
import { createHash } from "crypto";

export const DEFAULT_FEE_SATS = 150;

/**
 * NOTE: We cannot use bitcoinjs-lib  hashForWitnessV0() because it returns
 * sighash (double SHA256) of the preimage, but we need just one SHA256 of the
 * preimage because Ika will hash again when signing.
 *
 */

function hash256(buffer: Buffer): Buffer {
	return createHash("sha256").update(createHash("sha256").update(buffer).digest()).digest();
}

export interface UtxoInput {
	txid: string;
	vout: number;
	amount: number;
	script_pubkey: Uint8Array;
}

export interface TxOutput {
	amount: number;
	script: Uint8Array;
}

export function computeBtcSighash(
	inputs: UtxoInput[],
	outputs: TxOutput[],
	inputIdx: number,
): Uint8Array {
	if (inputIdx >= inputs.length) {
		throw new Error(`Invalid inputIdx ${inputIdx}, only ${inputs.length} inputs`);
	}

	const tx = new Transaction();
	tx.version = 2;

	for (const input of inputs) {
		const txidBuffer = Buffer.from(input.txid, "hex").reverse();
		tx.addInput(txidBuffer, input.vout, 0xffffffff);
	}

	for (const output of outputs) {
		tx.addOutput(Buffer.from(output.script), output.amount);
	}

	const input = inputs[inputIdx];
	if (!input) {
		throw new Error(`Input at index ${inputIdx} not found`);
	}

	const scriptPubkey = Buffer.from(input.script_pubkey);
	if (scriptPubkey.length !== 22 || scriptPubkey[0] !== 0x00 || scriptPubkey[1] !== 0x14) {
		throw new Error("Invalid P2WPKH script_pubkey format");
	}

	const pubkeyHash = scriptPubkey.subarray(2, 22);

	const scriptcode = Buffer.concat([
		Buffer.from([0x76, 0xa9, 0x14]),
		pubkeyHash,
		Buffer.from([0x88, 0xac]),
	]);

	const hashType = Transaction.SIGHASH_ALL;

	const preimage = buildSegwitPreimage(tx, inputIdx, scriptcode, input.amount, hashType);

	const sighash = createHash("sha256").update(preimage).digest();

	return new Uint8Array(sighash);
}

function buildSegwitPreimage(
	tx: Transaction,
	inputIdx: number,
	scriptcode: Buffer,
	amount: number,
	hashType: number,
): Buffer {
	const prevoutsBuffer = Buffer.concat(
		tx.ins.map((input) => {
			const indexBuf = Buffer.alloc(4);
			indexBuf.writeUInt32LE(input.index);
			return Buffer.concat([Buffer.from(input.hash).reverse(), indexBuf]);
		}),
	);
	const hashPrevouts = hash256(prevoutsBuffer);
	const sequencesBuffer = Buffer.concat(
		tx.ins.map((input) => {
			const seqBuf = Buffer.alloc(4);
			seqBuf.writeUInt32LE(input.sequence);
			return seqBuf;
		}),
	);
	const hashSequence = hash256(sequencesBuffer);
	const outputsBuffer = Buffer.concat(
		tx.outs.map((output) => {
			const valueBuf = Buffer.alloc(8);
			valueBuf.writeBigUInt64LE(BigInt(output.value));
			const scriptLen = Buffer.from([output.script.length]);
			return Buffer.concat([valueBuf, scriptLen, output.script]);
		}),
	);
	const hashOutputs = hash256(outputsBuffer);

	const input = tx.ins[inputIdx];
	if (!input) throw new Error(`Input ${inputIdx} not found`);

	const versionBuf = Buffer.alloc(4);
	versionBuf.writeInt32LE(tx.version);

	const outpointHash = Buffer.from(input.hash).reverse();
	const outpointIndexBuf = Buffer.alloc(4);
	outpointIndexBuf.writeUInt32LE(input.index);

	const scriptcodeLen = Buffer.from([scriptcode.length]);

	const amountBuf = Buffer.alloc(8);
	amountBuf.writeBigUInt64LE(BigInt(amount));

	const sequenceBuf = Buffer.alloc(4);
	sequenceBuf.writeUInt32LE(input.sequence);

	const locktimeBuf = Buffer.alloc(4);
	locktimeBuf.writeUInt32LE(tx.locktime);

	const hashtypeBuf = Buffer.alloc(4);
	hashtypeBuf.writeUInt32LE(hashType);

	return Buffer.concat([
		versionBuf,
		hashPrevouts,
		hashSequence,
		outpointHash,
		outpointIndexBuf,
		scriptcodeLen,
		scriptcode,
		amountBuf,
		sequenceBuf,
		hashOutputs,
		locktimeBuf,
		hashtypeBuf,
	]);
}
