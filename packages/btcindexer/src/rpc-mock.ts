import { WorkerEntrypoint } from "cloudflare:workers";
import { BtcIndexerRpcMockBase } from "./rpc-mock-base";

/**
 * Mock RPC entrypoint for btcindexer worker.
 * This is a stateless in-memory mock for local development without external dependencies.
 * It extends WorkerEntrypoint and uses the BtcIndexerRpcMockBase mixin for the implementation.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/
 */
export class MockBtcIndexerRpc extends BtcIndexerRpcMockBase {
	// WorkerEntrypoint fields
	protected ctx: ExecutionContext;
	protected env: Env;

	constructor(ctx: ExecutionContext, env: Env) {
		super();
		this.ctx = ctx;
		this.env = env;
	}
}
