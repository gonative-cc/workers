import { SuiClient as Client, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import type { FinalizeRedeemCall, ProposeRedeemCall } from "./models";
import type { SuiNet } from "@gonative-cc/lib/nsui";

export interface SuiClientCfg {
	network: SuiNet;
	signerMnemonic: string;
}

export interface SuiClient {
	proposeRedeemUtxos(args: ProposeRedeemCall): Promise<string>;
	finalizeRedeemRequest(args: FinalizeRedeemCall): Promise<string>;
}

export class SuiClientImp implements SuiClient {
	private client: Client;
	private signer: Ed25519Keypair;

	constructor(cfg: SuiClientCfg) {
		const url = getFullnodeUrl(cfg.network);
		this.client = new Client({ url });
		this.signer = Ed25519Keypair.deriveKeypair(cfg.signerMnemonic);
	}

	async proposeRedeemUtxos(args: ProposeRedeemCall): Promise<string> {
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

		tx.setGasBudget(100000000); // TODO: Move to config

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

	async finalizeRedeemRequest(args: FinalizeRedeemCall): Promise<string> {
		const tx = new Transaction();
		const target = `${args.nbtcPkg}::nbtc::finalize_redeem_request`;
		tx.moveCall({
			target: target,
			arguments: [
				tx.object(args.nbtcContract),
				tx.pure.u64(args.redeemId),
				tx.object("0x6"), // clock
			],
		});

		tx.setGasBudget(100000000); // TODO: Move to config

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

export function createSuiClients(
	activeNetworks: SuiNet[],
	mnemonic: string,
): Map<SuiNet, SuiClient> {
	const clients = new Map<SuiNet, SuiClient>();
	for (const net of activeNetworks) {
		clients.set(
			net,
			new SuiClientImp({
				network: net,
				signerMnemonic: mnemonic,
			}),
		);
	}
	return clients;
}
