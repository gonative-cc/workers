import { WorkerEntrypoint } from "cloudflare:workers";

import { D1Storage } from "./storage";
import type {
	ConfirmingRedeemReq,
	RedeemRequestEventRaw,
	RedeemRequestResp,
	FinalizeRedeemTx,
} from "@gonative-cc/lib/rpc-types";

/**
 * RPC entrypoint for the worker.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/
 */
export class RPC extends WorkerEntrypoint<Env> {
	// TODO: check if we can use a proper type for address instead of string
	async isBtcBlocked(btcAddrs: string[]): Promise<boolean> {
		const storage = new D1Storage(this.env.DB);
		return storage.isBtcBlocked(btcAddrs);
	}
}
