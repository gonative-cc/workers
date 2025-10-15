import { beforeAll, afterAll } from "bun:test";

const noop = () => void 0;

beforeAll(() => {
	console.log = noop;
	console.debug = noop;
	console.info = noop;
});

afterAll(() => {
	// global teardown
});
