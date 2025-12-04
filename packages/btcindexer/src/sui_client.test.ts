import { describe, it, expect } from "bun:test";
import SuiClient from "./sui_client";
import type { NbtcPkgCfg } from "./models";
import { BtcNet } from "@gonative-cc/lib/nbtc";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const REGTEST_DATA_MINT = {
	BLOCK_HEX:
		"000000305c2f30d99ad69f247638613dcca7f455159e252878ea6fe10bbc4574a0076914d98ada655d950ac6507d14584fa679d12fb5203c384e52ef292d063fe29b1b645c4b6d68ffff7f200200000002020000000001010000000000000000000000000000000000000000000000000000000000000000ffffffff04022f0100ffffffff02de82814a0000000016001477174bfb906c0e52d750eac4b40fd86746ad50550000000000000000266a24aa21a9ed27611410788b35b819e10a0227f40f9bbc70df824e3a30879552f004b48451210120000000000000000000000000000000000000000000000000000000000000000000000000020000000001017fec0755f3524b89ad45383343f992a0d5cb797a695b59e30f2fc80794f001050000000000fdffffff032202089200000000160014b125723e78c2d779e3e299dfd95d72e9a067a0b780f0fa02000000001600144cc99479ada301056d78a8f3676cfb404d696abe00000000000000000d6a0b3078313233343536373839024730440220755610ff6b6fdea530c20d11b7765816beb75e16ce78fa200a7da25e251a7eb9022078e78bed1cc38822cd5dce3982e23c3cd401415ae72050b00c5f8b3441a2c178012103ef55b72bddf4960ddbb12a9a04f61f91fb613aa99b472115f25a5f8686e6c3f200000000",
	TX_ID: "2060dfd3cdbffb7db6c968357f3c9df91b52a4cef5c02fad0b0836b0f25cc4ca",
	BLOCK_HEIGHT: 303,
};

// NOTE: skip to prevent this test from running in CI
describe.skip("SuiClient: verifyBlocks Integration Test", () => {
	it("should return true for valid block hashes and false for invalid ones", async () => {
		const LC_PACKAGE_ID = "0xe2583071745598f610bd38560ea244742738d51e0d684a967ee6ea4e19b7dc2f";
		const LC_OBJECT_ID = "0x00ae9947bb1099980f0663dc1eaa74fa5a400265b204928a823aebddeb84b6d7";
		const LC_MODULE_NAME = "light_client";

		// VALID_BLOCK_HASH does exists in the LC
		// INVALID_BLOCK_HASH does NOT exsist in the LC
		const VALID_BLOCK_HASH = "0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206";
		const INVALID_BLOCK_HASH =
			"06226e46111a0b59caaf126043eb5bbf28c34f3a5e332a1fc7b2b73cf188910f";

		const SUI_FALLBACK_ADDRESS = "0xFALLBACK";
		const TEST_MNEMONIC =
			"test mnemonic test mnemonic test mnemonic test mnemonic test mnemonic test mnemonic";
		const pkgConfig: NbtcPkgCfg = {
			id: 1,
			sui_network: "localnet",
			btc_network: BtcNet.REGTEST,
			lc_pkg: LC_PACKAGE_ID,
			lc_contract_id: LC_OBJECT_ID,
			nbtc_pkg: "0x1",
			nbtc_contract_id: "0x2",
			sui_fallback_address: SUI_FALLBACK_ADDRESS,
			is_active: 1,
		};

		const suiClient = new SuiClient(pkgConfig, TEST_MNEMONIC);
		const results = await suiClient.verifyBlocks([VALID_BLOCK_HASH, INVALID_BLOCK_HASH]);
		expect(results).toEqual([true, false]);
	});
});
