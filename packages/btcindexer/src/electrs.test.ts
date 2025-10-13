import { vi } from "bun:test";
import { Electrs } from "./electrs";

export function mkElectrsServiceMock(): Electrs {
	return {
		getTx: vi.fn(),
	};
}
