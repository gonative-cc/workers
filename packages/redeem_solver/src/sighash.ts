import { Transaction } from "bitcoinjs-lib";
import { createHash } from "crypto";

export const DEFAULT_FEE_SATS = 150;

/**
 * BIP341 Taproot sighash implementation.
 *
 * We build the preimage (TAG || TAG || ext_flag || sigmsg) and return it so Ika can hash it.
 * We can't use bitcoinjs-lib's hashForWitnessV1 because it returns the final double-hashed
 * result, but we need just the preimage since Ika will do the SHA256 when signing.
 *
 * Format: TAG || TAG || ext_flag || sigmsg
 * - TAG = SHA256("TapSighash") = f40a48df...
 * - ext_flag = 0x00 (no annex)
 * - sigmsg = BIP341 signature message
 */

const SIGHASH_DEFAULT = 0x00;
const SIGHASH_ALL = 0x01;
const SIGHASH_NONE = 0x02;
const SIGHASH_SINGLE = 0x03;
const SIGHASH_ANYONECANPAY = 0x80;
const SIGHASH_OUTPUT_MASK = 0x03;
const SIGHASH_INPUT_MASK = 0x80;
const TAG_HASH_TAPSIGHASH = Buffer.from(
	"f40a48df4b2a70c8b4924bf2654661ed3d95fd66a313eb87237597c628e4a031",
	"hex",
);

export interface UtxoInput {
	txid: string;
	vout: number;
	amount: number;
	script_pubkey: Uint8Array;
	sequence?: number; // Optional default is 0xffffffff
}

export interface TxOutput {
	amount: number;
	script: Uint8Array;
}

function sha256(data: Buffer) {
	return createHash("sha256").update(data).digest();
}

function writeVarSlice(buffer: Buffer): Buffer {
	const length = buffer.length;
	if (length < 0xfd) {
		return Buffer.concat([Buffer.from([length]), buffer]);
	} else if (length <= 0xffff) {
		const lenBuf = Buffer.alloc(3);
		lenBuf.writeUInt8(0xfd, 0);
		lenBuf.writeUInt16LE(length, 1);
		return Buffer.concat([lenBuf, buffer]);
	} else if (length <= 0xffffffff) {
		const lenBuf = Buffer.alloc(5);
		lenBuf.writeUInt8(0xfe, 0);
		lenBuf.writeUInt32LE(length, 1);
		return Buffer.concat([lenBuf, buffer]);
	} else {
		const lenBuf = Buffer.alloc(9);
		lenBuf.writeUInt8(0xff, 0);
		lenBuf.writeBigUInt64LE(BigInt(length), 1);
		return Buffer.concat([lenBuf, buffer]);
	}
}

export function computeBtcSighash(
	inputs: UtxoInput[],
	outputs: TxOutput[],
	inputIdx: number,
	hashType: number = SIGHASH_DEFAULT,
	locktime = 0,
): Uint8Array {
	if (inputs.length === 0) {
		throw new Error("Inputs array cannot be empty");
	}
	if (outputs.length === 0) {
		throw new Error("Outputs array cannot be empty");
	}
	if (inputIdx < 0 || inputIdx >= inputs.length) {
		throw new Error(`Invalid inputIdx ${inputIdx}, only ${inputs.length} inputs`);
	}

	const tx = new Transaction();
	tx.version = 2;
	tx.locktime = locktime;

	for (const input of inputs) {
		const txidBuffer = Buffer.from(input.txid, "hex").reverse();
		tx.addInput(txidBuffer, input.vout, input.sequence ?? 0xffffffff);
	}

	for (const output of outputs) {
		tx.addOutput(Buffer.from(output.script), BigInt(output.amount));
	}

	const sigmsg = buildTaprootSigMsg(tx, inputs, outputs, inputIdx, hashType);

	// BIP341 format: TAG || TAG || ext_flag || sigmsg
	const message = Buffer.concat([
		TAG_HASH_TAPSIGHASH,
		TAG_HASH_TAPSIGHASH,
		Buffer.from([0x00]), // ext_flag: 0x00
		sigmsg,
	]);

	return new Uint8Array(message);
}

/**
 * Builds the BIP341 Taproot signature message (similar structure to bitcoinjs-lib's hashForWitnessV1)
 */
function buildTaprootSigMsg(
	tx: Transaction,
	inputs: UtxoInput[],
	outputs: TxOutput[],
	inputIdx: number,
	hashType: number,
): Buffer {
	const outputType = hashType === SIGHASH_DEFAULT ? SIGHASH_ALL : hashType & SIGHASH_OUTPUT_MASK;
	const inputType = hashType & SIGHASH_INPUT_MASK;
	const isAnyoneCanPay = inputType === SIGHASH_ANYONECANPAY;
	const isNone = outputType === SIGHASH_NONE;
	const isSingle = outputType === SIGHASH_SINGLE;

	let hashPrevouts = Buffer.alloc(0);
	let hashAmounts = Buffer.alloc(0);
	let hashScriptPubkeys = Buffer.alloc(0);
	let hashSequences = Buffer.alloc(0);

	if (!isAnyoneCanPay) {
		const prevoutsData = Buffer.concat(
			tx.ins.map((input) => {
				const voutBuf = Buffer.alloc(4);
				voutBuf.writeUInt32LE(input.index);
				return Buffer.concat([Buffer.from(input.hash), voutBuf]);
			}),
		);
		hashPrevouts = sha256(prevoutsData);

		const amountsData = Buffer.concat(
			inputs.map((input) => {
				const buf = Buffer.alloc(8);
				buf.writeBigUInt64LE(BigInt(input.amount));
				return buf;
			}),
		);
		hashAmounts = sha256(amountsData);

		const scriptsData = Buffer.concat(
			inputs.map((input) => writeVarSlice(Buffer.from(input.script_pubkey))),
		);
		hashScriptPubkeys = sha256(scriptsData);

		const sequencesData = Buffer.concat(
			tx.ins.map((input) => {
				const buf = Buffer.alloc(4);
				buf.writeUInt32LE(input.sequence);
				return buf;
			}),
		);
		hashSequences = sha256(sequencesData);
	}

	let hashOutputs = Buffer.alloc(0);
	if (!isNone && !isSingle) {
		const outputsData = Buffer.concat(
			outputs.map((output) => {
				const valueBuf = Buffer.alloc(8);
				valueBuf.writeBigUInt64LE(BigInt(output.amount));
				return Buffer.concat([valueBuf, writeVarSlice(Buffer.from(output.script))]);
			}),
		);
		hashOutputs = sha256(outputsData);
	} else if (isSingle && inputIdx < outputs.length) {
		const output = outputs[inputIdx];
		if (!output) {
			throw new Error(`Output at index ${inputIdx} not found`);
		}
		const valueBuf = Buffer.alloc(8);
		valueBuf.writeBigUInt64LE(BigInt(output.amount));
		hashOutputs = sha256(Buffer.concat([valueBuf, writeVarSlice(Buffer.from(output.script))]));
	}

	const parts: Buffer[] = [];

	parts.push(Buffer.from([hashType]));

	const versionBuf = Buffer.alloc(4);
	versionBuf.writeInt32LE(tx.version);
	parts.push(versionBuf);

	const locktimeBuf = Buffer.alloc(4);
	locktimeBuf.writeUInt32LE(tx.locktime);
	parts.push(locktimeBuf);

	parts.push(hashPrevouts);
	parts.push(hashAmounts);
	parts.push(hashScriptPubkeys);
	parts.push(hashSequences);

	if (!isNone && !isSingle) {
		parts.push(hashOutputs);
	}

	// spend_type: 0x00 for keypath spending (no script path, no annex)
	parts.push(Buffer.from([0x00]));

	if (isAnyoneCanPay) {
		const input = tx.ins[inputIdx];
		const inputData = inputs[inputIdx];
		if (!input || !inputData) {
			throw new Error(`Input at index ${inputIdx} not found`);
		}
		const voutBuf = Buffer.alloc(4);
		voutBuf.writeUInt32LE(input.index);
		const amountBuf = Buffer.alloc(8);
		amountBuf.writeBigUInt64LE(BigInt(inputData.amount));
		const sequenceBuf = Buffer.alloc(4);
		sequenceBuf.writeUInt32LE(input.sequence);

		parts.push(Buffer.from(input.hash));
		parts.push(voutBuf);
		parts.push(amountBuf);
		parts.push(writeVarSlice(Buffer.from(inputData.script_pubkey)));
		parts.push(sequenceBuf);
	} else {
		const indexBuf = Buffer.alloc(4);
		indexBuf.writeUInt32LE(inputIdx);
		parts.push(indexBuf);
	}
	if (isSingle) {
		parts.push(hashOutputs);
	}

	return Buffer.concat(parts);
}
