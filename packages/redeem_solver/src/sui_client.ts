import { SuiClient as Client, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import type { ProposeRedeemArgs } from "@gonative-cc/lib/types";
import { toSuiNet } from "@gonative-cc/lib/nsui";

export interface SuiClientCfg {
	network: string;
	signerMnemonic: string;
}

export default interface SuiClient {
	proposeRedeemUtxos(args: ProposeRedeemArgs): Promise<string>;
}

export class SuiClientImp implements SuiClient {
	private client: Client;
	private signer: Ed25519Keypair;

	constructor(cfg: SuiClientCfg) {
		const url = getFullnodeUrl(toSuiNet(cfg.network));
		this.client = new Client({ url });
		this.signer = Ed25519Keypair.deriveKeypair(cfg.signerMnemonic);
	}

	async proposeRedeemUtxos(args: ProposeRedeemArgs): Promise<string> {
		const tx = new Transaction();
		const target = `${args.nbtcPkg}::nbtc::propose_utxos`;
		tx.moveCall({
			target: target,
			arguments: [
				tx.object(args.nbtcContract),
				tx.pure.u64(args.redeemId),
				tx.pure.vector("u64", args.utxoIds), // utxo_ids
				tx.pure.vector("address", args.dwalletIds), // dwallet_ids
				tx.object("0x6"), // clock
			],
		});

		tx.setGasBudget(100000000);

		const result = await this.client.signAndExecuteTransaction({
			signer: this.signer,
			transaction: tx,
			options: {
				showEffects: true,
			},
		});

		if (result.effects?.status.status !== "success") {
			throw new Error(`Transaction failed: ${result.effects?.status.error}`);
		}

		return result.digest;
	}
}
