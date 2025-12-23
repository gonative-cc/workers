import { WorkerEntrypoint } from "cloudflare:workers";
import { D1Storage } from "./storage";
import type { RedeemRequest } from "./models";

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

	async redeemsBySuiAddr(suiAddress: string, nbtcPkg: string): Promise<RedeemRequest[]> {
		const storage = new D1Storage(this.env.DB);
		return storage.getRedeemsBySuiAddr(suiAddress, nbtcPkg);
	}
}
