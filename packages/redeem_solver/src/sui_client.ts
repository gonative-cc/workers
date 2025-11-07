import type { NbtcCfg } from "@gonative-cc/lib/nsui";

// TODO: need to add more params
export interface SuiClientCfg extends NbtcCfg {
	signerMnemonic: string;
}

export default interface SuiClient {
	proposeRedeemUtxos(): Promise<void>;
}

export async function suiClientFromEnv(): Promise<SuiClient> {
	return new SuiClientImp({} as SuiClientCfg);
}

class SuiClientImp implements SuiClient {
	cfg: SuiClientCfg;

	constructor(cfg: SuiClientCfg) {
		this.cfg = cfg;
	}

	async proposeRedeemUtxos(): Promise<void> {
		return;
	}
}
