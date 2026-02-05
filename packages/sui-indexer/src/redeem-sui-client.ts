import { SuiClient as Client, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";

import type { SuiNet } from "@gonative-cc/lib/nsui";
import { prepareCoin } from "@gonative-cc/lib/coin-ops";
import { nBTCContractModule, RedeemRequestModule } from "@gonative-cc/nbtc";

import type { SolveRedeemCall, ProposeRedeemCall, FinalizeRedeemCall } from "./models";
import { type IkaClient, createIkaClient } from "./ika_client";

export interface SuiClientCfg {
	network: SuiNet;
	signerMnemonic: string;
	ikaClient: IkaClient;
	client: Client;
	ikaSignCost: number;
	ikaPresignCost: number;
}

export interface SuiClient {
	ikaClient(): IkaClient;
	proposeRedeemUtxos(args: ProposeRedeemCall): Promise<string>;
	solveRedeemRequest(args: SolveRedeemCall): Promise<string>;
	finalizeRedeem(args: FinalizeRedeemCall): Promise<string>;
	requestIkaPresigns(count: number): Promise<string[]>;
	requestInputSignature(
		redeemId: number,
		inputIdx: number,
		nbtcPublicSignature: Uint8Array,
		presignId: string,
		nbtcPkg: string,
		nbtcContract: string,
	): Promise<string>;
	validateSignatures(
		redeemId: number,
		inputs: { input_index: number; sign_id: string }[],
		nbtcPkg: string,
		nbtcContract: string,
	): Promise<void>;
	getRedeemBtcTx(redeemId: number, nbtcPkg: string, nbtcContract: string): Promise<string>;
}

class SuiClientImp implements SuiClient {
	#sui: Client;
	#ika: IkaClient;
	private signer: Ed25519Keypair;
	private encryptionKeyId: string | null = null;
	private ikaSignCost: number;
	private ikaPresignCost: number;

	constructor(cfg: SuiClientCfg) {
		this.#sui = cfg.client;
		this.signer = Ed25519Keypair.deriveKeypair(cfg.signerMnemonic);
		this.#ika = cfg.ikaClient;
		this.ikaSignCost = cfg.ikaSignCost;
		this.ikaPresignCost = cfg.ikaPresignCost;
	}

	ikaClient() {
		return this.#ika;
	}

	async getRedeemBtcTx(redeemId: number, nbtcPkg: string, nbtcContract: string): Promise<string> {
		const tx = new Transaction();

		const redeem = tx.add(
			nBTCContractModule.redeemRequest({
				package: nbtcPkg,
				arguments: {
					contract: nbtcContract,
					redeemId: redeemId,
				},
			}),
		);

		const storage = tx.add(
			nBTCContractModule.storage({
				package: nbtcPkg,
				arguments: {
					contract: nbtcContract,
				},
			}),
		);

		tx.add(
			RedeemRequestModule.composeTx({
				package: nbtcPkg,
				arguments: {
					r: redeem,
					storage: storage,
				},
			}),
		);

		const result = await this.#sui.devInspectTransactionBlock({
			transactionBlock: tx,
			sender: this.signer.toSuiAddress(),
		});

		if (result.error) {
			throw new Error(`DevInspect failed: ${result.error}`);
		}

		// results[0] = redeem_request, results[1] = storage, results[2] = raw_signed_tx
		const rawTxResult = result.results?.[2]?.returnValues?.[0]?.[0];
		if (!rawTxResult) {
			throw new Error("Failed to get raw_signed_tx result");
		}
		const decoded = Uint8Array.from(rawTxResult);
		return Buffer.from(decoded).toString("hex");
	}

	async proposeRedeemUtxos(args: ProposeRedeemCall): Promise<string> {
		const tx = new Transaction();

		tx.add(
			nBTCContractModule.proposeUtxos({
				package: args.nbtcPkg,
				arguments: {
					contract: args.nbtcContract,
					redeemId: args.redeemId,
					utxoIds: args.utxoIds.map((u) => BigInt(u)),
				},
			}),
		);

		tx.setGasBudget(100000000); // TODO: Move to config

		const result = await this.#sui.signAndExecuteTransaction({
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

	async solveRedeemRequest(args: SolveRedeemCall): Promise<string> {
		const tx = new Transaction();

		tx.add(
			nBTCContractModule.solveRedeemRequest({
				package: args.nbtcPkg,
				arguments: {
					contract: args.nbtcContract,
					redeemId: args.redeemId,
				},
			}),
		);

		tx.setGasBudget(100000000); // TODO: Move to config

		const result = await this.#sui.signAndExecuteTransaction({
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

	async finalizeRedeem(args: FinalizeRedeemCall): Promise<string> {
		const tx = new Transaction();

		tx.add(
			nBTCContractModule.finalizeRedeem({
				package: args.nbtcPkg,
				arguments: {
					contract: args.nbtcContract,
					lightClient: args.lcContract,
					redeemId: args.redeemId,
					proof: args.proof.map((p) => Array.from(Buffer.from(p, "hex"))),
					height: args.height,
					txIndex: args.txIndex,
				},
			}),
		);
		const result = await this.#sui.signAndExecuteTransaction({
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

	async requestIkaPresigns(count: number): Promise<string[]> {
		if (count <= 0) return [];
		const tx = new Transaction();
		const signer = this.signer.toSuiAddress();
		const ikaCoins = await this.#ika.fetchAllIkaCoins(signer);
		const totalCost = BigInt(this.ikaPresignCost) * BigInt(count);
		const { preparedCoin: paymentIka } = prepareCoin(ikaCoins, totalCost, tx);

		if (!this.encryptionKeyId) {
			const dWalletEncryptionKey = await this.#ika.getLatestNetworkEncryptionKeyId();
			this.encryptionKeyId = dWalletEncryptionKey;
		}
		const amounts = Array(count).fill(this.ikaPresignCost);
		const coins = tx.splitCoins(
			paymentIka,
			amounts.map((a) => BigInt(a)),
		);

		const caps = [];
		for (let i = 0; i < count; i++) {
			const presignCap = this.#ika.requestGlobalPresign(
				tx,
				coins[i]!,
				tx.gas,
				this.encryptionKeyId,
			);
			caps.push(presignCap);
		}
		tx.transferObjects([...caps, paymentIka], this.signer.toSuiAddress());

		const result = await this.#sui.signAndExecuteTransaction({
			signer: this.signer,
			transaction: tx,
			options: { showEvents: true },
		});

		if (result.effects?.status.status !== "success") {
			throw new Error(`Batch presign request failed: ${result.effects?.status.error}`);
		}

		const presignIds: string[] = [];
		if (result.events) {
			for (const event of result.events) {
				if (event.type.includes("PresignRequestEvent")) {
					const decoded = this.#ika.decodePresignRequestEvent(event.bcs as string);
					presignIds.push(decoded.presign_id);
				}
			}
		}

		if (presignIds.length !== count) {
			throw new Error(
				`Expected ${count} presign IDs, but got ${presignIds.length}. Transaction digest: ${result.digest}`,
			);
		}

		return presignIds;
	}

	async requestInputSignature(
		redeemId: number,
		inputIdx: number,
		nbtcPublicSignature: Uint8Array,
		presignId: string,
		nbtcPkg: string,
		nbtcContract: string,
	): Promise<string> {
		const tx = new Transaction();
		const signer = this.signer.toSuiAddress();
		const ikaCoins = await this.#ika.fetchAllIkaCoins(signer);
		const { preparedCoin: paymentIka } = prepareCoin(ikaCoins, BigInt(this.ikaSignCost), tx);
		const coordinatorId = this.#ika.getCoordinatorId();
		const presign = await this.#ika.getCompletedPresign(presignId);
		tx.add(
			nBTCContractModule.requestUtxoSig({
				package: nbtcPkg,
				arguments: {
					contract: nbtcContract,
					dwalletCoordinator: coordinatorId,
					redeemId: redeemId,
					inputId: inputIdx,
					presign: presign.cap_id,
					paymentIka,
					msgCentralSig: Array.from(nbtcPublicSignature),
					paymentSui: tx.gas,
				},
			}),
		);

		const result = await this.#sui.signAndExecuteTransaction({
			signer: this.signer,
			transaction: tx,
			options: { showEvents: true },
		});

		if (result.effects?.status.status !== "success") {
			throw new Error(`Signature request failed: ${result.effects?.status.error}`);
		}

		const event = result.events?.find((e) => e.type.includes("SignRequestEvent"));
		if (!event) {
			throw new Error("SignRequestEvent not found");
		}

		const decoded = this.#ika.decodeSignRequestEvent(event.bcs as string);
		return decoded.sign_id;
	}

	async validateSignatures(
		redeemId: number,
		inputs: { input_index: number; sign_id: string }[],
		nbtcPkg: string,
		nbtcContract: string,
	): Promise<void> {
		if (inputs.length === 0) return;
		const tx = new Transaction();
		const coordinatorId = this.#ika.getCoordinatorId();

		tx.add(
			nBTCContractModule.recordSignature({
				package: nbtcPkg,
				arguments: {
					contract: nbtcContract,
					dwalletCoordinator: coordinatorId,
					redeemId: redeemId,
					inputIds: inputs.map((i) => BigInt(i.input_index)),
					signIds: inputs.map((i) => i.sign_id),
				},
			}),
		);

		const result = await this.#sui.signAndExecuteTransaction({
			signer: this.signer,
			transaction: tx,
			options: {
				showEffects: true,
			},
		});

		if (result.effects?.status.status !== "success") {
			throw new Error(`Signature validation failed: ${result.effects?.status.error}`);
		}
	}
}

// NOTE: ika decimals=9. 1 IKA = 1e3 miniIKA
const miniIka = 1e6;

export async function createSuiClients(
	activeNetworks: SuiNet[],
	mnemonic: string,
): Promise<Map<SuiNet, SuiClient>> {
	const clients = new Map<SuiNet, SuiClient>();
	for (const net of activeNetworks) {
		const url = getFullnodeUrl(net);
		const mystenClient = new Client({ url });
		const ikaClient = await createIkaClient(net, mystenClient);
		clients.set(
			net,
			new SuiClientImp({
				network: net,
				signerMnemonic: mnemonic,
				ikaClient: ikaClient,
				client: mystenClient,
				// TODO:: We can get the function about pricing use this endpoint:
				// https://github.com/dwallet-labs/ika/blob/01efcabe6282164b242040f0e338de6de164ae41/deployed_contracts/testnet/ika_dwallet_2pc_mpc/sources/coordinator.move#L807
				// cost fee here is estimated relatively
				// sign cost = 0.2 ika * 60% = 0.32 ika
				// presign cost = 0.15 * 60% = 0.24 ika
				ikaSignCost: 320 * miniIka,
				ikaPresignCost: 240 * miniIka,
			}),
		);
	}
	return clients;
}
