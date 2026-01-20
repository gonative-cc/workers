import { describe, it, expect, mock, beforeEach } from "bun:test";
import { SuiEventHandler } from "./handler";
import type { D1Storage } from "./storage";
import type { SuiClient } from "./redeem-sui-client";
import type { SuiEventNode } from "./models";
import type { SuiNet } from "@gonative-cc/lib/nsui";

function createMockStorage() {
	return {
		getRedeemInfoBySignId: mock(() => Promise.resolve(null)),
		markRedeemInputVerified: mock(() => Promise.resolve()),
	} as unknown as D1Storage;
}

function createMockSuiClient() {
	return {
		validateSignature: mock(() => Promise.resolve()),
	} as unknown as SuiClient;
}

function createCompletedSignEvent(signId: string): SuiEventNode {
	return {
		type: "0x123::coordinator_inner::CompletedSignEvent",
		txDigest: "0xTxDigest123",
		timestamp: "1234567890",
		json: {
			sign_id: signId,
			is_future_sign: false,
			signature: [1, 2, 3, 4],
		},
	};
}

describe("SuiEventHandler - handleIkaEvents", () => {
	let mockStorage: ReturnType<typeof createMockStorage>;
	let mockSuiClient: ReturnType<typeof createMockSuiClient>;
	let suiClients: Map<SuiNet, SuiClient>;

	beforeEach(() => {
		mockStorage = createMockStorage();
		mockSuiClient = createMockSuiClient();
		suiClients = new Map([["testnet" as SuiNet, mockSuiClient]]);
	});

	it("handleCompletedSign should call validateSignature when sign_id is found", async () => {
		const redeemInfo = {
			redeem_id: 1,
			utxo_id: 10,
			input_index: 0,
			nbtc_pkg: "0xNbtcPkg",
			nbtc_contract: "0xNbtcContract",
			sui_network: "testnet" as SuiNet,
		};
		mockStorage.getRedeemInfoBySignId = mock(() => Promise.resolve(redeemInfo));

		const handler = new SuiEventHandler(mockStorage, 1, suiClients);
		const event = createCompletedSignEvent("signId123");

		await handler.handleIkaEvents([event]);

		expect(mockStorage.getRedeemInfoBySignId).toHaveBeenCalledWith("signId123");
		expect(mockSuiClient.validateSignature).toHaveBeenCalledWith(
			1,
			0,
			"signId123",
			"0xNbtcPkg",
			"0xNbtcContract",
		);
		expect(mockStorage.markRedeemInputVerified).toHaveBeenCalledWith(1, 10);
	});

	it("handleCompletedSign should skip when sign_id is not found", async () => {
		mockStorage.getRedeemInfoBySignId = mock(() => Promise.resolve(null));

		const handler = new SuiEventHandler(mockStorage, 1, suiClients);
		const event = createCompletedSignEvent("unknownSignId");

		await handler.handleIkaEvents([event]);

		expect(mockStorage.getRedeemInfoBySignId).toHaveBeenCalledWith("unknownSignId");
		expect(mockSuiClient.validateSignature).not.toHaveBeenCalled();
		expect(mockStorage.markRedeemInputVerified).not.toHaveBeenCalled();
	});
});
