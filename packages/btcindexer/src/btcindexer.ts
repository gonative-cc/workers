import { address, networks, Block, Transaction, type Network } from "bitcoinjs-lib";
import { OP_RETURN } from "./opcodes";
import { BitcoinMerkleTree } from "./bitcoin-merkle-tree";
import SuiClient, { suiClientFromEnv } from "./sui_client";
import type {
	Deposit,
	PendingTx,
	NbtcTxResp,
	MintBatchArg,
	GroupedFinalizedTx,
	NbtcAddress,
	NbtcTxRow,
} from "./models";
import { BlockStatus, MintTxStatus } from "./models";
import { toSerializableError } from "./errutils";
import type { Electrs } from "./electrs";
import { ElectrsService } from "./electrs";
import type { Storage } from "./storage";
import { CFStorage } from "./cf-storage";
import { BtcNet, type BlockQueueMessage } from "@gonative-cc/lib/nbtc";
import type { PutNbtcTxResponse } from "./rpc-interface";

const btcNetworkCfg: Record<BtcNet, Network> = {
	[BtcNet.MAINNET]: networks.bitcoin,
	[BtcNet.TESTNET]: networks.testnet,
	[BtcNet.REGTEST]: networks.regtest,
	[BtcNet.SIGNET]: networks.testnet,
};

export async function indexerFromEnv(
	env: Env,
	nbtcAddressesMap: Map<string, NbtcAddress>,
): Promise<Indexer> {
	const storage = new CFStorage(env.DB, env.btc_blocks, env.nbtc_txs);
	const sc = await suiClientFromEnv(env);

	const confirmationDepth = parseInt(env.CONFIRMATION_DEPTH || "8", 10);
	if (isNaN(confirmationDepth) || confirmationDepth < 1) {
		throw new Error("Invalid CONFIRMATION_DEPTH in config. Must be a number greater than 0.");
	}

	const maxNbtcMintTxRetries = parseInt(env.MAX_NBTC_MINT_TX_RETRIES || "1", 10);
	if (isNaN(maxNbtcMintTxRetries) || maxNbtcMintTxRetries < 0) {
		throw new Error("Invalid MAX_NBTC_MINT_TX_RETRIES in config. Must be a number >= 0.");
	}

	return new Indexer(
		storage,
		sc,
		nbtcAddressesMap,
		env.SUI_FALLBACK_ADDRESS,
		confirmationDepth,
		maxNbtcMintTxRetries,
		new ElectrsService(env.ELECTRS_API_URL),
	);
}

export class Indexer {
	storage: Storage;
	electrs: Electrs;
	suiFallbackAddr: string;
	nbtcClient: SuiClient;
	confirmationDepth: number;
	maxNbtcMintTxRetries: number;
	nbtcAddressesMap: Map<string, NbtcAddress>;

	constructor(
		storage: Storage,
		suiClient: SuiClient,
		nbtcAddressesMap: Map<string, NbtcAddress>,
		fallbackAddr: string,
		confirmationDepth: number,
		maxRetries: number,
		electrs: Electrs,
	) {
		this.storage = storage;
		this.nbtcClient = suiClient;
		this.suiFallbackAddr = fallbackAddr;
		this.nbtcAddressesMap = nbtcAddressesMap;

		if (nbtcAddressesMap.size === 0) {
			const err = new Error("No nBTC deposit addresses configured.");
			console.error({
				msg: "No nBTC deposit addresses configured.",
				error: toSerializableError(err),
			});
			throw err;
		}
		this.confirmationDepth = confirmationDepth;
		this.maxNbtcMintTxRetries = maxRetries;
		this.electrs = electrs;
	}

	// returns true if tx has not been processed yet, false if it was already inserted
	async putNbtcTx(): Promise<boolean> {
		// TODO
		// 1. check if tx is nBTC segwit payment
		// 2. check if not duplicated
		// 3. insert in D1
		// 4. insert in nbtcTxDB
		//    this.saveNbtcTx(tx)

		return true;
	}

	async processBlock(blockInfo: BlockQueueMessage): Promise<void> {
		console.log({
			msg: "Processing block from queue",
			height: blockInfo.height,
			hash: blockInfo.hash,
			network: blockInfo.network,
		});

		const rawBlockBuffer = await this.storage.getBlock(blockInfo.hash);
		if (!rawBlockBuffer) {
			throw new Error(`Block data not found in KV for hash: ${blockInfo.hash}`);
		}
		const block = Block.fromBuffer(Buffer.from(rawBlockBuffer));
		const network = btcNetworks[blockInfo.network];

		if (!network) {
			throw new Error(`Unknown network: ${blockInfo.network}`);
		}

		const nbtcTxs: {
			txId: string;
			vout: number;
			blockHash: string;
			blockHeight: number;
			suiRecipient: string;
			amountSats: number;
			btc_network: string;
			nbtc_pkg: string;
			sui_network: string;
		}[] = [];
		let senders: { txId: string; sender: string }[] = [];

		for (const tx of block.transactions ?? []) {
			const deposits = this.findNbtcDeposits(tx, network);
			if (deposits.length > 0) {
				const newSenders = await this.getSenderAddresses(tx);
				senders = senders.concat(newSenders.map((s) => ({ txId: tx.getId(), sender: s })));
			}

			for (const deposit of deposits) {
				console.log({
					msg: "Found new nBTC deposit",
					txId: tx.getId(),
					vout: deposit.vout,
					amountSats: deposit.amountSats,
					suiRecipient: deposit.suiRecipient,
					nbtc_pkg: deposit.nbtc_pkg,
					sui_network: deposit.sui_network,
				});

				nbtcTxs.push({
					txId: tx.getId(),
					vout: deposit.vout,
					blockHash: blockInfo.hash,
					blockHeight: blockInfo.height,
					suiRecipient: deposit.suiRecipient,
					amountSats: deposit.amountSats,
					btc_network: blockInfo.network,
					nbtc_pkg: deposit.nbtc_pkg,
					sui_network: deposit.sui_network,
				});
			}
		}

		if (nbtcTxs.length > 0) {
			await this.storage.insertOrUpdateNbtcTxs(nbtcTxs);
		}

		if (senders.length > 0) {
			await this.storage.insertBtcDeposit(senders);
		}

		if (nbtcTxs.length === 0) {
			console.debug({ msg: "No new nBTC deposits found in block" });
		}

		await this.storage.updateBlockStatus(
			blockInfo.hash,
			blockInfo.network,
			BlockStatus.Scanned,
		);
		await this.storage.setChainTip(blockInfo.height);
	}

	findNbtcDeposits(tx: Transaction, network: networks.Network): Deposit[] {
		const deposits: Deposit[] = [];
		let suiRecipient: string | null = null;

		for (const vout of tx.outs) {
			const parsedRecipient = parseSuiRecipientFromOpReturn(vout.script);
			if (parsedRecipient) {
				suiRecipient = parsedRecipient;
				console.debug({
					msg: "Parsed Sui recipient from OP_RETURN",
					txId: tx.getId(),
					suiRecipient,
				});
				break; // valid tx should have only one OP_RETURN
			}
		}

		if (!suiRecipient) suiRecipient = this.suiFallbackAddr;

		for (let i = 0; i < tx.outs.length; i++) {
			const vout = tx.outs[i];
			if (!vout) {
				continue;
			}
			if (vout.script && vout.script[0] === OP_RETURN) {
				continue;
			}
			try {
				const btcAddress = address.fromOutputScript(vout.script, network);
				const matchingNbtcAddress = this.nbtcAddressesMap.get(btcAddress);
				if (matchingNbtcAddress) {
					console.debug({
						msg: "Found matching nBTC deposit output",
						txId: tx.getId(),
						vout: i,
					});
					deposits.push({
						vout: i,
						amountSats: Number(vout.value),
						suiRecipient,
						nbtc_pkg: matchingNbtcAddress.nbtc_pkg,
						sui_network: matchingNbtcAddress.sui_network,
					});
				}
			} catch (e) {
				// This is expected for coinbase transactions and other non-standard scripts.
				console.debug({ msg: "Error parsing output script", error: e });
			}
		}
		return deposits;
	}

	async processFinalizedTransactions(): Promise<void> {
		const finalizedTxs = await this.storage.getNbtcFinalizedTxs(this.maxNbtcMintTxRetries);

		if (!finalizedTxs || finalizedTxs.length === 0) {
			return;
		}
		console.log({
			msg: "Minting: Found deposits to process",
			count: finalizedTxs.length,
		});

		// Group all finalized deposits by their parent transaction ID.
		// A single Bitcoin transaction can contain multiple outputs (vouts) that pay to the nBTC
		// deposit address. While the transaction typically has only one OP_RETURN to specify the
		// Sui recipient, that single recipient applies to *all* deposit outputs within that transaction.
		// Our indexer stores each of these deposits as a separate row.
		// For the on-chain minting process, however all deposits from a single transaction must be
		// processed together because they share a single Merkle proof. This grouping step
		// collects all related deposits to generate a single proof. These groups are then further
		// batched by their destination nBTC package for the final minting calls.
		//
		// TODO: Consider refactoring the database schema to store one row per transaction, rather than
		// per deposit output. The schema could have columns like `vouts` (a list of vout indexes),
		// `total_amount`, and `op_return_data`. This would align the database structure more
		// closely with the on-chain reality and could simplify this function by removing the
		// need for this grouping step.
		const groupedTxs = new Map<string, GroupedFinalizedTx>();
		for (const row of finalizedTxs) {
			const group = groupedTxs.get(row.tx_id);
			if (group) {
				group.deposits.push(row);
			} else {
				groupedTxs.set(row.tx_id, {
					block_hash: row.block_hash,
					block_height: row.block_height,
					deposits: [row],
				});
			}
		}

		const mintBatchArgsByPkg = new Map<string, MintBatchArg[]>();
		const processedKeysByPkg = new Map<string, { tx_id: string; vout: number }[]>();

		for (const [txId, txGroup] of groupedTxs.entries()) {
			try {
				const rawBlockBuffer = await this.storage.getBlock(txGroup.block_hash);
				if (!rawBlockBuffer) {
					console.warn({
						msg: "Minting: Block data not found in KV, skipping transaction.",
						txId,
						blockHash: txGroup.block_hash,
					});
					continue;
				}
				const block = Block.fromBuffer(Buffer.from(rawBlockBuffer));
				const merkleTree = this.constructMerkleTree(block);
				if (!merkleTree) continue;

				if (!block.transactions) {
					continue;
				}

				const txIndex = block.transactions.findIndex((tx) => tx.getId() === txId);

				if (txIndex === -1) {
					console.error({
						msg: "Minting: Could not find TX within its block. Setting status to 'finalized-reorg'.",
						txId,
					});
					try {
						// TODO: need to distniguish FINALIZED_REORG and MINTED_REORG
						await this.storage.updateNbtcTxsStatus([txId], MintTxStatus.FinalizedReorg);
					} catch (e) {
						console.error({
							msg: "Minting: Failed to update status to 'finalized-reorg'",
							error: toSerializableError(e),
							txId,
						});
						throw e;
					}
					continue;
				}

				const targetTx = block.transactions[txIndex];
				if (!targetTx) continue;

				const proof = this.getTxProof(merkleTree, targetTx);

				// NOTE: Soundness check. A mismatch between our calculated
				// Merkle root and the one in the block header should  never happen.
				// If it does, it indicates that the merkle tree implementaiton is incorrect,
				// corrupted block data in KV, or a faulty realyer (sending us wrong data).
				const calculatedRoot = merkleTree.getRoot();
				if (
					!proof ||
					(block.merkleRoot !== undefined && !block.merkleRoot.equals(calculatedRoot))
				) {
					console.error({
						msg: "Failed to generate a valid merkle proof. Root mismatch.",
						txId,
						blockRoot: block.merkleRoot?.toString("hex"),
						calculatedRoot: calculatedRoot.toString("hex"),
					});
					continue;
				}

				const firstDeposit = txGroup.deposits[0];
				if (!firstDeposit) {
					console.warn({
						msg: "Minting: Skipping transaction group with no deposits",
						txId,
					});
					continue;
				}
				const nbtc_pkg = firstDeposit.nbtc_pkg;
				const sui_network = firstDeposit.sui_network;
				const pkgKey = `${nbtc_pkg}-${sui_network}`;

				if (!nbtc_pkg || !sui_network) {
					console.warn({
						msg: "Minting: Skipping transaction group with missing nbtc_pkg or sui_network, likely old data.",
						txId,
					});
					continue;
				}

				if (!mintBatchArgsByPkg.has(pkgKey)) {
					mintBatchArgsByPkg.set(pkgKey, []);
					processedKeysByPkg.set(pkgKey, []);
				}

				const mintBatchArgs = mintBatchArgsByPkg.get(pkgKey);
				if (mintBatchArgs) {
					mintBatchArgs.push({
						tx: targetTx,
						blockHeight: txGroup.block_height,
						txIndex: txIndex,
						proof: { proofPath: proof, merkleRoot: calculatedRoot.toString("hex") },
						nbtc_pkg: nbtc_pkg,
						sui_network: sui_network,
					});
				}

				for (const deposit of txGroup.deposits) {
					const processedKeys = processedKeysByPkg.get(pkgKey);
					if (processedKeys) {
						processedKeys.push({
							tx_id: deposit.tx_id,
							vout: deposit.vout,
						});
					}
				}
			} catch (e) {
				console.error({
					msg: "Minting: Error preparing transaction for minting batch, will retry",
					error: toSerializableError(e),
					txId,
				});
				// NOTE: We don't update the status here. The transaction will be picked up
				// again in the next run of processFinalizedTransactions.
			}
		}

		if (mintBatchArgsByPkg.size > 0) {
			for (const [pkgKey, mintBatchArgs] of mintBatchArgsByPkg.entries()) {
				const processedPrimaryKeys = processedKeysByPkg.get(pkgKey);
				if (!processedPrimaryKeys || processedPrimaryKeys.length === 0) {
					continue;
				}

				console.log({
					msg: "Minting: Sending batch of mints to Sui",
					count: mintBatchArgs.length,
					pkgKey: pkgKey,
				});

				const suiTxDigest = await this.nbtcClient.tryMintNbtcBatch(mintBatchArgs);
				if (suiTxDigest) {
					console.log({
						msg: "Sui batch mint transaction successful",
						suiTxDigest,
						pkgKey,
					});
					await this.storage.batchUpdateNbtcTxs(
						processedPrimaryKeys.map((p) => ({
							tx_id: p.tx_id,
							vout: p.vout,
							status: MintTxStatus.Minted,
							suiTxDigest,
						})),
					);
				} else {
					console.error({ msg: "Sui batch mint transaction failed", pkgKey });
					await this.storage.batchUpdateNbtcTxs(
						processedPrimaryKeys.map((p) => ({
							tx_id: p.tx_id,
							vout: p.vout,
							status: MintTxStatus.MintFailed,
						})),
					);
				}
			}
		}
	}

	constructMerkleTree(block: Block): BitcoinMerkleTree | null {
		if (!block.transactions || block.transactions.length === 0) {
			return null;
		}
		return new BitcoinMerkleTree(block.transactions);
	}

	getTxProof(tree: BitcoinMerkleTree, targetTx: Transaction): Buffer[] | null {
		try {
			return tree.getProof(targetTx);
		} catch (e) {
			console.error({
				msg: "Failed to get merkle proof",
				error: toSerializableError(e),
				txId: targetTx.getId(),
			});
			return null;
		}
	}

	// Queries the light client to verify that blocks containing
	// 'confirming' txs are still part of the canonical chain.
	// This is used to detect reorgs before proceeding to finalization attempts.
	async verifyConfirmingBlocks(): Promise<void> {
		console.debug({
			msg: "SPV Check: Verifying 'confirming' blocks with on-chain light client.",
		});

		const blocksToVerify = await this.storage.getConfirmingBlocks();
		if (!blocksToVerify || blocksToVerify.length === 0) {
			console.debug({ msg: "SPV Check: No confirming blocks to verify." });
			return;
		}

		const blockHashes = blocksToVerify.map((r) => r.block_hash);

		try {
			const verificationResults = await this.nbtcClient.verifyBlocks(blockHashes);
			const invalidHashes: string[] = [];
			for (let i = 0; i < blockHashes.length; i++) {
				if (verificationResults[i] === false) {
					const blockHash = blockHashes[i];
					if (blockHash) {
						invalidHashes.push(blockHash);
					}
				}
			}

			if (invalidHashes.length > 0) {
				console.warn({
					msg: "SPV Check: Detected reorged blocks. Updating transaction statuses.",
					reorgedBlockHashes: invalidHashes,
				});
				await this.storage.updateConfirmingTxsToReorg(invalidHashes);
			} else {
				console.debug({ msg: "SPV Check: All confirming blocks are valid." });
			}
		} catch (e) {
			console.error({
				msg: "SPV Check: Failed to verify blocks with on-chain light client.",
				error: toSerializableError(e),
			});
		}
	}

	async updateConfirmationsAndFinalize(latestHeight: number): Promise<void> {
		// check the confirming blocks against the SPV.
		await this.verifyConfirmingBlocks();

		const pendingTxs = await this.storage.getConfirmingTxs();
		if (!pendingTxs || pendingTxs.length === 0) {
			return;
		}
		console.debug({
			msg: "Finalization: Checking 'confirming' transactions",
			count: pendingTxs.length,
			chainTipHeight: latestHeight,
		});

		const { reorgedTxIds } = await this.handleReorgs(pendingTxs);
		if (reorgedTxIds.length > 0) {
			console.debug({
				msg: "Finalization: Updating reorged transactions",
				count: reorgedTxIds.length,
			});
			// This requires a new method in the Storage interface like:
			// updateTxsStatus(txIds: string[], status: TxStatus): Promise<void>
			await this.storage.updateNbtcTxsStatus(reorgedTxIds, MintTxStatus.Reorg);
		}

		// TODO: add a unit test for it so we make sure we do not finalize reorrged tx.
		const validPendingTxs = pendingTxs.filter((tx) => !reorgedTxIds.includes(tx.tx_id));
		const finalizationTxIds = this.selectFinalizedNbtcTxs(validPendingTxs, latestHeight);

		if (finalizationTxIds.length > 0) {
			console.debug({
				msg: "Finalization: Applying status updates to D1",
				finalizedCount: finalizationTxIds.length,
			});
			await this.storage.finalizeNbtcTxs(finalizationTxIds);
		}
	}

	async handleReorgs(pendingTxs: PendingTx[]): Promise<{ reorgedTxIds: string[] }> {
		const reorgedTxIds: string[] = [];
		for (const tx of pendingTxs) {
			if (tx.block_hash === null) continue;
			const newBlockInQueue = await this.storage.getBlockInfo(
				tx.block_height,
				tx.btc_network,
			);
			if (newBlockInQueue) {
				if (newBlockInQueue.hash !== tx.block_hash) {
					console.warn({
						msg: "Reorg detected",
						txId: tx.tx_id,
						height: tx.block_height,
						oldHash: tx.block_hash,
						newHash: newBlockInQueue.hash,
					});
					reorgedTxIds.push(tx.tx_id);
				}
			}
		}
		return { reorgedTxIds };
	}

	selectFinalizedNbtcTxs(pendingTxs: PendingTx[], latestHeight: number): string[] {
		const txIds: string[] = [];
		for (const tx of pendingTxs) {
			const confirmations = latestHeight - tx.block_height + 1;
			if (confirmations >= this.confirmationDepth) {
				console.log({
					msg: "Transaction has enough confirmations, finalizing.",
					txId: tx.tx_id,
					confirmations,
					required: this.confirmationDepth,
				});
				txIds.push(tx.tx_id);
			}
		}
		return txIds;
	}

	// queries NbtcTxResp by BTC Tx ID
	async getNbtcMintTx(txid: string): Promise<NbtcTxResp | null> {
		const nbtMintRow = await this.storage.getNbtcMintTx(txid);
		if (!nbtMintRow) return null;

		const latestHeight = await this.storage.getChainTip();

		return nbtcRowToResp(nbtMintRow, latestHeight);
	}

	async getNbtcMintTxsBySuiAddr(suiAddress: string): Promise<NbtcTxResp[]> {
		const latestHeight = await this.storage.getChainTip();
		const dbResult = await this.storage.getNbtcMintTxsBySuiAddr(suiAddress);

		return dbResult.map((tx): NbtcTxResp => {
			const blockHeight = tx.block_height as number;
			const confirmations = blockHeight && latestHeight ? latestHeight - blockHeight + 1 : 0;
			return {
				...tx,
				btc_tx_id: tx.tx_id,
				status: tx.status as MintTxStatus,
				block_height: blockHeight,
				confirmations: confirmations > 0 ? confirmations : 0,
			};
		});
	}

	async registerBroadcastedNbtcTx(txHex: string, network: BtcNet): Promise<PutNbtcTxResponse> {
		const tx = Transaction.fromHex(txHex);
		const txId = tx.getId();
		const btcNetwork = btcNetworks[network];
		if (!btcNetwork) {
			throw new Error(`Unknown network: ${network}`);
		}
		const deposits = this.findNbtcDeposits(tx, btcNetwork);
		if (deposits.length === 0) {
			throw new Error("Transaction does not contain any valid nBTC deposits.");
		}
		const depositData = deposits.map((d) => ({ ...d, txId, btc_network: network }));
		await this.storage.registerBroadcastedNbtcTx(depositData);
		console.log({
			msg: "New nBTC minting deposit TX registered",
			txId,
			registeredCount: deposits.length,
		});
		return { tx_id: txId, registered_deposits: deposits.length };
	}

	async getLatestHeight(): Promise<{ height: number | null }> {
		const height = await this.storage.getLatestBlockHeight();
		return { height };
	}

	async getDepositsBySender(btcAddress: string): Promise<NbtcTxResp[]> {
		const nbtcMintRows = await this.storage.getNbtcMintTxsByBtcSender(btcAddress);
		const latestHeight = await this.storage.getChainTip();

		return nbtcMintRows.map((r) => nbtcRowToResp(r, latestHeight));
	}

	private async getSenderAddresses(tx: Transaction): Promise<string[]> {
		const senderAddresses = new Set<string>();
		const prevTxFetches = tx.ins.map(async (input) => {
			const prevTxId = Buffer.from(input.hash).reverse().toString("hex");
			const prevTxVout = input.index;
			try {
				const response = await this.electrs.getTx(prevTxId);
				if (!response.ok) return;
				const prevTx = (await response.json()) as {
					vout: { scriptpubkey_address?: string }[];
				};
				const prevOutput = prevTx.vout[prevTxVout];
				if (prevOutput?.scriptpubkey_address) {
					senderAddresses.add(prevOutput.scriptpubkey_address);
				}
			} catch (e) {
				console.error({
					msg: "Failed to fetch previous tx for sender address via service binding",
					error: toSerializableError(e),
					prevTxId,
				});
			}
		});
		await Promise.all(prevTxFetches);
		return Array.from(senderAddresses);
	}
}

function parseSuiRecipientFromOpReturn(script: Buffer): string | null {
	if (script.length === 0 || script[0] !== OP_RETURN) {
		return null;
	}
	if (script.length < 2) {
		return null;
	}
	const payload = script.subarray(2);

	// Check simple transfer format: 1-byte flag (0x00)
	// TODO: add validation for the sui address
	if (payload[0] === 0x00) {
		const addressBytes = payload.subarray(1);
		return `0x${addressBytes.toString("hex")}`;
	}
	//TODO: in the future we need to update the relayer to correctly handle the flag 0x01
	// for now we cannot determine the recipient
	return null;
}

function nbtcRowToResp(r: NbtcTxRow, latestHeight: number | null): NbtcTxResp {
	const bh = r.block_height;
	const confirmations = bh && latestHeight ? latestHeight - bh + 1 : 0;
	const btc_tx_id = r.tx_id;
	// @ts-expect-error The operand of a 'delete' operator must be optional
	delete r.tx_id;

	return {
		btc_tx_id,
		confirmations: confirmations > 0 ? confirmations : 0,
		...r,
	};
}
