import { WorkerEntrypoint } from "cloudflare:workers";
// import { Storage } from "./storage";

/**
 * RPC entrypoint for the worker.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/
 */
export class RPC extends WorkerEntrypoint<Env> {
	/**
	 * Based on tx result, it shoud lock the UTXOs and mark them as spent
	 * TODO (in the future): we need to observe which UTXOs has been spent because maybe
	 * someone else proposes a better one.
	 */
	async proposeRedeemUtxos(): Promise<void> {
		return;
	}
}
