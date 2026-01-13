import { describe, it, expect } from "bun:test";
import { computeBtcSighash, DEFAULT_FEE_SATS, type UtxoInput, type TxOutput } from "./sighash";
import { createHash } from "crypto";

describe("computeBtcSighash - Taproot (BIP341)", () => {
	// Test data from bitcoin_lib::sighash::test_taproot_sighash_preimage
	// Raw transaction hex from Move contract test:
	// 02000000097de20cbff686da83a54981d2b9bab3586f4ca7e48f57f5b55963115f3b334e9c010000000000000000d7b7cab57b1393ace2d064f4d4a2cb8af6def61273e127517d44759b6dafdd990000000000fffffffff8e1f583384333689228c5d28eac13366be082dc57441760d957275419a418420000000000fffffffff0689180aa63b30cb162a73c6d2a38b7eeda2a83ece74310fda0843ad604853b0100000000feffffff0c638ca38362001f5e128a01ae2b379288eb22cfaf903652b2ec1c88588f487a0000000000feffffff956149bdc66faa968eb2be2d2faa29718acbfe3941215893a2a3446d32acd05000000000000000000081efa267f1f0e46e054ecec01773de7c844721e010c2db5d5864a6a6b53e013a010000000000000000a690669c3c4a62507d93609810c6de3f99d1a6e311fe39dd23683d695c07bdee0000000000ffffffff727ab5f877438496f8613ca84002ff38e8292f7bd11f0a9b9b83ebd16779669e0100000000ffffffff0200ca9a3b000000001976a91406afd46bcdfd22ef94ac122aa11f241244a37ecc88ac807840cb0000000020ac9a87f5594be208f8532db38cff670c450ed2fea8fcdefcc9a663f78bab962b0065cd1d
	// Reference: https://github.com/bitcoinjs/bitcoinjs-lib/blob/13aea8c84236fe14d7260a9ffaaf0a0489ef70b1/test/fixtures/transaction.json#L812

	const createInput = (
		txid: string,
		vout: number,
		amount: number,
		scriptHex: string,
		sequence?: number,
	): UtxoInput => ({
		txid,
		vout,
		amount,
		script_pubkey: new Uint8Array(Buffer.from(scriptHex, "hex")),
		sequence,
	});

	const createOutput = (amount: number, scriptHex: string): TxOutput => ({
		amount,
		script: new Uint8Array(Buffer.from(scriptHex, "hex")),
	});

	const TEST_INPUTS: UtxoInput[] = [
		createInput(
			"9c4e333b5f116359b5f5578fe4a74c6f58b3bab9d28149a583da86f6bf0ce27d",
			1,
			420000000,
			"512053a1f6e454df1aa2776a2814a721372d6258050de330b3c6d10ee8f4e0dda343",
			0,
		),
		createInput(
			"99ddaf6d9b75447d5127e17312f6def68acba2d4f464d0e2ac93137bb5cab7d7",
			0,
			462000000,
			"5120147c9c57132f6e7ecddba9800bb0c4449251c92a1e60371ee77557b6620f3ea3",
			0xffffffff,
		),
		createInput(
			"4218a419542757d960174457dc82e06b3613ac8ed2c528926833433883f5e1f8",
			0,
			294000000,
			"76a914751e76e8199196d454941c45d1b3a323f1433bd688ac",
			0xffffffff,
		), // P2PKH
		createInput(
			"3b8504d63a84a0fd1043e7ec832adaeeb7382a6d3ca762b10cb363aa809168f0",
			1,
			504000000,
			"5120e4d810fd50586274face62b8a807eb9719cef49c04177cc6b76a9a4251d5450e",
			0xfffffffe,
		),
		createInput(
			"7a488f58881cecb2523690afcf22eb8892372bae018a125e1f006283a38c630c",
			0,
			630000000,
			"512091b64d5324723a985170e4dc5a0f84c041804f2cd12660fa5dec09fc21783605",
			0xfffffffe,
		),
		createInput(
			"50d0ac326d44a3a29358214139fecb8a7129aa2f2dbeb28e96aa6fc6bd496195",
			0,
			378000000,
			"00147dd65592d0ab2fe0d0257d571abf032cd9db93dc",
			0,
		), // P2WPKH
		createInput(
			"3a013eb5a6a664585ddbc210e02147847cde7317c0ce4e056ee4f0f167a2ef81",
			1,
			672000000,
			"512075169f4001aa68f15bbed28b218df1d0a62cbbcf1188c6665110c293c907b831",
			0,
		),
		createInput(
			"eebd075c693d6823dd39fe11e3a6d1993fdec6109860937d50624a3c9c6690a6",
			0,
			546000000,
			"51200f63ca2c7639b9bb4be0465cc0aa3ee78a0761ba5f5f7d6ff8eab340f09da561",
			0xffffffff,
		),
		createInput(
			"9e667967d1eb839b9b0a1fd17b2f29e838ff0240a83c61f896844377f8b57a72",
			1,
			588000000,
			"5120053690babeabbb7850c32eead0acf8df990ced79f7a31e358fabf2658b4bc587",
			0xffffffff,
		),
	];

	const TEST_OUTPUTS: TxOutput[] = [
		createOutput(1000000000, "76a91406afd46bcdfd22ef94ac122aa11f241244a37ecc88ac"),
		createOutput(
			3410000000,
			"ac9a87f5594be208f8532db38cff670c450ed2fea8fcdefcc9a663f78bab962b",
		),
	];

	const LOCKTIME = 500000000;

	it("should match Move contract Taproot test case", () => {
		// Test input_idx=3, hash_type=0x01 (SIGHASH_ALL), locktime=500000000
		const message = computeBtcSighash(TEST_INPUTS, TEST_OUTPUTS, 3, 0x01, LOCKTIME);
		const finalSighash = createHash("sha256").update(message).digest().toString("hex");
		// Expected from Move contract test
		const expected = "6ffd256e108685b41831385f57eebf2fca041bc6b5e607ea11b3e03d4cf9d9ba";
		expect(finalSighash).toBe(expected);
	});

	it("should match Move contract test case with SIGHASH_DEFAULT", () => {
		const message = computeBtcSighash(TEST_INPUTS, TEST_OUTPUTS, 4, 0x00, LOCKTIME);
		const finalSighash = createHash("sha256").update(message).digest().toString("hex");
		const expected = "9f90136737540ccc18707e1fd398ad222a1a7e4dd65cbfd22dbe4660191efa58";
		expect(finalSighash).toBe(expected);
	});

	it("should throw error for invalid input index", () => {
		const inputs = [
			createInput(
				"9c4e333b5f116359b5f5578fe4a74c6f58b3bab9d28149a583da86f6bf0ce27d",
				1,
				420000000,
				"512053a1f6e454df1aa2776a2814a721372d6258050de330b3c6d10ee8f4e0dda343",
			),
		];
		const outputs = [
			createOutput(1000000000, "76a91406afd46bcdfd22ef94ac122aa11f241244a37ecc88ac"),
		];
		expect(() => computeBtcSighash(inputs, outputs, 5)).toThrow(
			"Invalid inputIdx 5, only 1 inputs",
		);
	});

	it("should throw error for empty inputs array", () => {
		const outputs = [
			createOutput(1000000000, "76a91406afd46bcdfd22ef94ac122aa11f241244a37ecc88ac"),
		];
		expect(() => computeBtcSighash([], outputs, 0)).toThrow("Inputs array cannot be empty");
	});

	it("should throw error for empty outputs array", () => {
		const inputs = [
			createInput(
				"9c4e333b5f116359b5f5578fe4a74c6f58b3bab9d28149a583da86f6bf0ce27d",
				1,
				420000000,
				"512053a1f6e454df1aa2776a2814a721372d6258050de330b3c6d10ee8f4e0dda343",
			),
		];
		expect(() => computeBtcSighash(inputs, [], 0)).toThrow("Outputs array cannot be empty");
	});

	it("should throw error for negative input index", () => {
		const inputs = [
			createInput(
				"9c4e333b5f116359b5f5578fe4a74c6f58b3bab9d28149a583da86f6bf0ce27d",
				1,
				420000000,
				"512053a1f6e454df1aa2776a2814a721372d6258050de330b3c6d10ee8f4e0dda343",
			),
		];
		const outputs = [
			createOutput(1000000000, "76a91406afd46bcdfd22ef94ac122aa11f241244a37ecc88ac"),
		];
		expect(() => computeBtcSighash(inputs, outputs, -1)).toThrow(
			"Invalid inputIdx -1, only 1 inputs",
		);
	});

	it("should use correct default fee constant", () => {
		expect(DEFAULT_FEE_SATS).toBe(150);
	});
});
