import { describe, it, expect } from "bun:test";
import { isAuthorized } from "@gonative-cc/lib/auth";

describe("block-ingestor auth helper", () => {
	const env = {
		AUTH_BEARER_TOKEN: "test-token",
		BtcBlocks: {} as KVNamespace,
		BlockQueue: {} as Queue,
		BtcIndexer: {} as Fetcher,
	} as unknown as Env;

	it("should return false if no auth header", () => {
		const request = new Request("http://localhost");
		expect(isAuthorized(request.headers, env.AUTH_BEARER_TOKEN)).toBe(false);
	});

	it("should return false if token mismatch", () => {
		const request = new Request("http://localhost", {
			headers: {
				Authorization: "Bearer wrong-token",
			},
		});
		expect(isAuthorized(request.headers, env.AUTH_BEARER_TOKEN)).toBe(false);
	});

	it("should return true if token matches", () => {
		const request = new Request("http://localhost", {
			headers: {
				Authorization: "Bearer test-token",
			},
		});
		expect(isAuthorized(request.headers, env.AUTH_BEARER_TOKEN)).toBe(true);
	});

	it("should return false if AUTH_BEARER_TOKEN is missing in env", () => {
		const envMissing = {
			BtcBlocks: {} as KVNamespace,
			BlockQueue: {} as Queue,
			BtcIndexer: {} as Fetcher,
		} as unknown as Env;
		const request = new Request("http://localhost", {
			headers: {
				Authorization: "Bearer test-token",
			},
		});
		expect(isAuthorized(request.headers, envMissing.AUTH_BEARER_TOKEN)).toBe(false);
	});
});
