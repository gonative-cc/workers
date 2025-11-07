import { vi } from "bun:test";
import type { Electrs } from "./electrs";

export function mkElectrsServiceMock(): Electrs {
	return {
		getTx: vi.fn(),
	};
}
