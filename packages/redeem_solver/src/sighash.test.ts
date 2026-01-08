import { describe, it, expect } from "bun:test";
import { computeBtcSighash, DEFAULT_FEE_SATS, type UtxoInput, type TxOutput } from "./sighash";

describe("computeBtcSighash", () => {
	it("should compute 32-byte sighash", () => {
		const inputs: UtxoInput[] = [
			{
				txid: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
				vout: 0,
				amount: 100000,
				script_pubkey: new Uint8Array([
					0x00, 0x14, 0x12, 0x34, 0x56, 0x78, 0x90, 0xab, 0xcd, 0xef, 0x12, 0x34, 0x56,
					0x78, 0x90, 0xab, 0xcd, 0xef, 0x12, 0x34, 0x56, 0x78,
				]),
			},
		];

		const outputs: TxOutput[] = [
			{
				amount: 49850,
				script: new Uint8Array([
					0x00, 0x14, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x11, 0x22, 0x33, 0x44, 0x55,
					0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee,
				]),
			},
		];

		const sighash = computeBtcSighash(inputs, outputs, 0);
		expect(sighash.length).toBe(32);
		expect(sighash).toBeInstanceOf(Uint8Array);
	});

	it("should throw error for invalid input index", () => {
		const inputs: UtxoInput[] = [
			{
				txid: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
				vout: 0,
				amount: 100000,
				script_pubkey: new Uint8Array([
					0x00, 0x14, 0x12, 0x34, 0x56, 0x78, 0x90, 0xab, 0xcd, 0xef, 0x12, 0x34, 0x56,
					0x78, 0x90, 0xab, 0xcd, 0xef, 0x12, 0x34, 0x56, 0x78,
				]),
			},
		];
		const outputs: TxOutput[] = [
			{
				amount: 99850,
				script: new Uint8Array([0x00, 0x14, ...Array(20).fill(0xaa)]),
			},
		];
		expect(() => computeBtcSighash(inputs, outputs, 5)).toThrow(
			"Invalid inputIdx 5, only 1 inputs",
		);
	});

	it("should throw error for invalid P2WPKH script format", () => {
		const inputs: UtxoInput[] = [
			{
				txid: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
				vout: 0,
				amount: 100000,
				script_pubkey: new Uint8Array([0x76, 0xa9, 0x14]),
			},
		];

		const outputs: TxOutput[] = [
			{
				amount: 99850,
				script: new Uint8Array([0x00, 0x14, ...Array(20).fill(0xaa)]),
			},
		];

		expect(() => computeBtcSighash(inputs, outputs, 0)).toThrow(
			"Invalid P2WPKH script_pubkey format",
		);
	});

	it("should use correct default fee constant", () => {
		expect(DEFAULT_FEE_SATS).toBe(150);
	});

	it("should match Move contract test case from bitcoin_lib::sighash", () => {
		// Test data from: https://github.com/gonative-cc/sui-native/blob/master/bitcoin_lib/sources/sighash.move
		const inputs: UtxoInput[] = [
			{
				txid: "ac4994014aa36b7f53375658ef595b3cb2891e1735fe5b441686f5e53338e76a",
				vout: 1,
				amount: 30000,
				script_pubkey: new Uint8Array([
					0x00, 0x14, 0xaa, 0x96, 0x6f, 0x56, 0xde, 0x59, 0x9b, 0x40, 0x94, 0xb6, 0x1a,
					0xa6, 0x8a, 0x2b, 0x3d, 0xf9, 0xe9, 0x7e, 0x9c, 0x48,
				]),
			},
		];
		const outputs: TxOutput[] = [
			{
				amount: 20000,
				script: new Uint8Array([
					0x76, 0xa9, 0x14, 0xce, 0x72, 0xab, 0xfd, 0x0e, 0x6d, 0x93, 0x54, 0xa6, 0x60,
					0xc1, 0x8f, 0x28, 0x25, 0xeb, 0x39, 0x2f, 0x06, 0x0f, 0xdc, 0x88, 0xac,
				]),
			},
		];

		const sighash = computeBtcSighash(inputs, outputs, 0);
		const sighashHex = Buffer.from(sighash).toString("hex");

		// Expected sighash: SHA256 of the Move contract's preimage
		// Move preimage: 02000000cbfaca386d65ea7043aaac40302325d0dc7391a73b585571e28d3287d6b162033bb13029ce7b1f559ef5e747fcac439f1455a2ec7c5f09b72290795e70665044ac4994014aa36b7f53375658ef595b3cb2891e1735fe5b441686f5e53338e76a010000001976a914aa966f56de599b4094b61aa68a2b3df9e97e9c4888ac3075000000000000ffffffff900a6c6ff6cd938bf863e50613a4ed5fb1661b78649fe354116edaf5d4abb9520000000001000000
		const expectedSighashHex =
			"4f90b1caa95157e0abf8b22fdc98ecb44cb738ba0a0bdd94e84dde30c1eaa751";

		expect(sighashHex).toBe(expectedSighashHex);
		expect(sighash.length).toBe(32);
	});
});
