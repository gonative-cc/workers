import { beforeAll, afterAll, vi } from "bun:test";

const originalConsole = { ...console };

beforeAll(() => {
	if (process.env.ENABLE_LOGS !== "1") {
		for (const key of Object.keys(originalConsole)) {
			const m = key as keyof Console;
			if (typeof originalConsole[m] === "function") {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(console[m] as any) = vi.fn();
			}
		}
	}
});

afterAll(() => {
	Object.assign(console, originalConsole);
});
