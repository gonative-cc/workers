import { WorkerEntrypoint } from "cloudflare:workers";
import { D1Storage } from "./storage";

export interface ComplianceRpc {
	isAnyBtcAddressSanctioned: (btcAddresses: string[]) => Promise<boolean>;
}

export class RPC extends WorkerEntrypoint<Env> implements ComplianceRpc {
	isAnyBtcAddressSanctioned(btcAddresses: string[]): Promise<boolean> {
		const storage = new D1Storage(this.env.DB);
		return storage.isAnyBtcAddressSanctioned(btcAddresses);
	}
}
