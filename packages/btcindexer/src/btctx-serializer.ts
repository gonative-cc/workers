import { Transaction } from "bitcoinjs-lib";
import type { TxInput, TxOutput } from "bitcoinjs-lib";

export interface SerializedBtcTx {
	version: number[];
	inputCount: number;
	inputs: number[];
	outputCount: number;
	outputs: number[];
	lockTime: number[];
}

function serializeU32(n: number): number[] {
	const buffer = Buffer.alloc(4);
	buffer.writeUInt32LE(n, 0);
	return Array.from(buffer);
}

function serializeTxInputs(inputs: TxInput[]): number[] {
	const buffers = inputs.map((vin) => {
		const hash = Buffer.from(vin.hash);
		const index = Buffer.alloc(4);
		index.writeUInt32LE(vin.index, 0);
		const scriptLen = Buffer.from([vin.script.length]);
		const sequence = Buffer.alloc(4);
		sequence.writeUInt32LE(vin.sequence, 0);
		return Buffer.concat([hash, index, scriptLen, vin.script, sequence]);
	});
	return Array.from(Buffer.concat(buffers));
}

function serializeTxOutputs(outputs: TxOutput[]): number[] {
	const buffers = outputs.map((vout) => {
		const value = Buffer.alloc(8);
		value.writeBigUInt64LE(BigInt(vout.value), 0);
		const scriptLen = Buffer.from([vout.script.length]);
		return Buffer.concat([value, scriptLen, vout.script]);
	});
	return Array.from(Buffer.concat(buffers));
}

export function serializeBtcTx(transaction: Transaction): SerializedBtcTx {
	return {
		version: serializeU32(transaction.version),
		inputCount: transaction.ins.length,
		inputs: serializeTxInputs(transaction.ins),
		outputCount: transaction.outs.length,
		outputs: serializeTxOutputs(transaction.outs),
		lockTime: serializeU32(transaction.locktime),
	};
}
