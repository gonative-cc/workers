import { describe, it, expect } from "bun:test";
import { isAuthorized } from "./auth";

describe("block-ingestor auth helper", () => {
	const mockSecret = (value: string): SecretsStoreSecret => ({
		get: async () => value,
	});

	const env = {
		RELAYER_AUTH_TOKEN: mockSecret("test-token"),
		BtcBlocks: {} as KVNamespace,
		BlockQueue: {} as Queue,
		BtcIndexer: {} as Fetcher,
	} as Env;

	it("should return false if no auth header", async () => {
		const request = new Request("http://localhost");
		expect(await isAuthorized(request, env)).toBe(false);
	});

	it("should return false if token mismatch", async () => {
		const request = new Request("http://localhost", {
			headers: {
				Authorization: "Bearer wrong-token",
			},
		});
		expect(await isAuthorized(request, env)).toBe(false);
	});

	it("should return true if token matches", async () => {
		const request = new Request("http://localhost", {
			headers: {
				Authorization: "Bearer test-token",
			},
		});
		expect(await isAuthorized(request, env)).toBe(true);
	});

	it("should return true if token matches (case insensitive Bearer)", async () => {
		const request = new Request("http://localhost", {
			headers: {
				Authorization: "bearer test-token",
			},
		});
		expect(await isAuthorized(request, env)).toBe(true);
	});
});
