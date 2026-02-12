import { WorkerEntrypoint } from "cloudflare:workers";
import { D1Storage } from "./storage";
import type { ComplianceRpc } from "./types";

/**
 * RPC entrypoint for the worker.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/
 */
export class RPC extends WorkerEntrypoint<Env> implements ComplianceRpc {
	async isBtcBlocked(btcAddresses: string[]): Promise<Record<string, boolean>> {
		const storage = new D1Storage(this.env.DB);
		return storage.isBtcBlocked(btcAddresses);
	}
}
