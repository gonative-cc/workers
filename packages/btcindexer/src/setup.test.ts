import { beforeAll, afterAll, vi } from "bun:test";

const originalConsole = { ...console };

beforeAll(() => {
	console.log = vi.fn();
	console.info = vi.fn();
	console.warn = vi.fn();
	console.error = vi.fn();
	console.debug = vi.fn();
});

afterAll(() => {
	Object.assign(console, originalConsole);
});
