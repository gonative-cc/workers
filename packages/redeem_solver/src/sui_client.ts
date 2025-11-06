// TODO: reuse the one from btcindexer
export interface SuiClientCfg {
	network: string;
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
