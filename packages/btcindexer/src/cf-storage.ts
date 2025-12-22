import { logError, logger } from "@gonative-cc/lib/logger";
import type {
	BlockInfo,
	FinalizedTxRow,
	ReorgedMintedTx,
	NbtcTxRow,
	PendingTx,
	NbtcTxInsertion,
	NbtcTxUpdate,
	NbtcBroadcastedDeposit,
	ConfirmingBlockInfo,
	InsertBlockResult,
} from "./models";
import { MintTxStatus } from "./models";
import type { Storage } from "./storage";
import type { BlockQueueRecord, BtcNet } from "@gonative-cc/lib/nbtc";

export class CFStorage implements Storage {
	private d1: D1Database;
	private blocksDB: KVNamespace;
	private nbtcTxDB: KVNamespace;

	constructor(d1: D1Database, blocksDB: KVNamespace, nbtcTxDB: KVNamespace) {
		this.d1 = d1;
		this.blocksDB = blocksDB;
		this.nbtcTxDB = nbtcTxDB;
	}

	async getDepositAddresses(btcNetwork: BtcNet): Promise<string[]> {
		try {
			const { results } = await this.d1
				.prepare(
					`SELECT a.deposit_address
					 FROM nbtc_deposit_addresses a
					 JOIN nbtc_packages p ON a.package_id = p.id
					 WHERE p.btc_network = ? AND a.is_active = 1`,
				)
				.bind(btcNetwork)
				.all<{ deposit_address: string }>();
			return results ? results.map((r) => r.deposit_address) : [];
		} catch (e) {
			logError(
				{
					msg: "Failed to fetch deposit addresses from D1",
					method: "CFStorage.getDepositAddresses",
					btcNetwork,
				},
				e,
			);
			throw e;
		}
	}

	/**
	 * Inserts a new block record into D1 or updates an existing one if the incoming data is newer.
	 *
	 * This method implements a "Last-Write-Wins" strategy based on the ingestion timestamp (`inserted_at`)
	 * to handle out-of-order delivery (race conditions) from the queue.
	 *
	 * logic:
	 * 1. If the (height, network) does not exist -> INSERT.
	 * 2. If it exists, ONLY UPDATE if:
	 * - The Hash is different (optimization to skip duplicates).
	 * - AND The incoming `timestamp_ms` is greater than the stored `inserted_at`.
	 *
	 * @param b - The block record from the queue.
	 * @returns InsertBlockResult tells us whether the block was inserted, updated, or skipped.
	 */
	async insertBlockInfo(b: BlockQueueRecord): Promise<InsertBlockResult> {
		const checkRowStmt = this.d1.prepare(
			`SELECT 1 FROM btc_blocks WHERE height = ? AND network = ?`,
		);
		const insertStmt = this.d1.prepare(
			`INSERT INTO btc_blocks (hash, height, network, inserted_at) VALUES (?, ?, ?, ?)
			 ON CONFLICT(height, network) DO UPDATE SET
			   hash = excluded.hash,
			   inserted_at = excluded.inserted_at,
			   is_scanned = 0
			 WHERE btc_blocks.hash IS NOT excluded.hash AND excluded.inserted_at > btc_blocks.inserted_at`,
		);
		try {
			const results = await this.d1.batch([
				checkRowStmt.bind(b.height, b.network),
				insertStmt.bind(b.hash, b.height, b.network, b.timestamp_ms),
			]);

			const checkResult = results[0];
			const upsertResult = results[1];

			if (!checkResult || !upsertResult) {
				throw new Error("Batch operation failed");
			}

			const wasFound = checkResult.results.length > 0;
			const rowsChanged = upsertResult.meta.changes > 0;

			if (!wasFound) {
				return { status: "inserted", changed: true };
			} else if (rowsChanged) {
				return { status: "updated", changed: true };
			} else {
				return { status: "skipped", changed: false };
			}
		} catch (e) {
			logError(
				{
					msg: "Failed to insert block from queue message",
					method: "CFStorage.insertBlockInfo",
					message: b,
				},
				e,
			);
			throw e;
		}
	}

	async getBlocksToProcess(batchSize: number): Promise<BlockInfo[]> {
		const blocksToProcess = await this.d1
			.prepare(
				`SELECT height, hash FROM btc_blocks WHERE is_scanned = 0 ORDER BY height ASC LIMIT ?`,
			)
			.bind(batchSize)
			.all<BlockInfo>();
		return blocksToProcess.results ?? [];
	}

	async markBlockAsProcessed(hash: string, network: BtcNet): Promise<void> {
		const now = Date.now();
		const updateStmt = `UPDATE btc_blocks SET is_scanned = 1, processed_at = ? WHERE hash = ? AND network = ?`;
		try {
			await this.d1.prepare(updateStmt).bind(now, hash, network).run();
			logger.debug({
				msg: "Marked block as processed",
				hash,
				network,
			});
		} catch (e) {
			logError(
				{
					msg: "Failed to mark block as processed",
					method: "markBlockAsProcessed",
					hash,
					network,
				},
				e,
			);
			throw e;
		}
	}

	async getLatestBlockHeight(network: BtcNet): Promise<number | null> {
		const result = await this.d1
			.prepare("SELECT MAX(height) as height FROM btc_blocks WHERE network = ?")
			.bind(network)
			.first<{ height: number | null }>();
		return result?.height ?? null;
	}

	async getChainTip(network: BtcNet): Promise<number | null> {
		const latestHeightStr = await this.blocksDB.get(`chain_tip:${network}`);
		return latestHeightStr ? parseInt(latestHeightStr, 10) : null;
	}

	async setChainTip(height: number, network: BtcNet): Promise<void> {
		await this.blocksDB.put(`chain_tip:${network}`, height.toString());
	}

	async getBlock(hash: string): Promise<ArrayBuffer | null> {
		return this.blocksDB.get(hash, { type: "arrayBuffer" });
	}

	async getBlockHash(height: number, network: BtcNet): Promise<string | null> {
		const row = await this.d1
			.prepare("SELECT hash FROM btc_blocks WHERE height = ? AND network = ?")
			.bind(height, network)
			.first<{ hash: string }>();
		if (row === null) return null;
		return row.hash;
	}

	async insertOrUpdateNbtcTxs(txs: NbtcTxInsertion[]): Promise<void> {
		if (txs.length === 0) {
			return;
		}
		const now = Date.now();
		const insertOrUpdateNbtcTxStmt = this.d1.prepare(
			`INSERT INTO nbtc_minting (tx_id, address_id, sender, vout, block_hash, block_height, sui_recipient, amount_sats, status, created_at, updated_at, sui_tx_id, retry_count)
             VALUES (?, (SELECT a.id FROM nbtc_deposit_addresses a JOIN nbtc_packages p ON a.package_id = p.id WHERE p.btc_network = ? AND p.sui_network = ? AND p.nbtc_pkg = ? AND a.deposit_address = ?), ?, ?, ?, ?, ?, ?, '${MintTxStatus.Confirming}', ?, ?, NULL, 0)
             ON CONFLICT(tx_id) DO UPDATE SET
                block_hash = excluded.block_hash,
                block_height = excluded.block_height,
                status = '${MintTxStatus.Confirming}',
                updated_at = excluded.updated_at,
				address_id = excluded.address_id,
				sender = excluded.sender`,
		);
		const statements = txs.map((tx) =>
			insertOrUpdateNbtcTxStmt.bind(
				tx.txId,
				tx.btcNetwork,
				tx.suiNetwork,
				tx.nbtcPkg,
				tx.depositAddress,
				tx.sender,
				tx.vout,
				tx.blockHash,
				tx.blockHeight,
				tx.suiRecipient,
				tx.amountSats,
				now,
				now,
			),
		);
		try {
			await this.d1.batch(statements);
		} catch (e) {
			logError(
				{
					msg: "Failed to insert nBTC transactions",
					method: "CFStorage.insertOrUpdateNbtcTxs",
				},
				e,
			);
			throw e;
		}
	}

	async getNbtcMintCandidates(maxRetries: number): Promise<FinalizedTxRow[]> {
		const finalizedTxs = await this.d1
			.prepare(
				`SELECT m.tx_id, m.vout, m.block_hash, m.block_height, m.retry_count, p.nbtc_pkg, p.sui_network, p.id as package_id
				 FROM nbtc_minting m
				 JOIN nbtc_deposit_addresses a ON m.address_id = a.id
				 JOIN nbtc_packages p ON a.package_id = p.id
				 WHERE m.status = '${MintTxStatus.Finalized}' OR (m.status = '${MintTxStatus.MintFailed}' AND m.retry_count <= ?)`,
			)
			.bind(maxRetries)
			.all<FinalizedTxRow>();
		return finalizedTxs.results ?? [];
	}

	// Returns all Bitcoin deposit transactions in or after the given block, that successfully minted nBTC.
	//TODO: We need to query by network
	async getMintedTxs(blockHeight: number): Promise<FinalizedTxRow[]> {
		const txs = await this.d1
			.prepare(
				`SELECT m.tx_id, m.vout, m.block_hash, m.block_height, p.nbtc_pkg, p.sui_network, p.btc_network
				 FROM nbtc_minting m
				 JOIN nbtc_deposit_addresses a ON m.address_id = a.id
				 JOIN nbtc_packages p ON a.package_id = p.id
				 WHERE m.status = '${MintTxStatus.Minted}' AND m.block_height >= ?`,
			)
			.bind(blockHeight)
			.all<FinalizedTxRow>();
		return txs.results ?? [];
	}

	//TODO: We need to query by network
	async getReorgedMintedTxs(blockHeight: number): Promise<ReorgedMintedTx[]> {
		const reorged = await this.d1
			.prepare(
				`SELECT
					m.tx_id,
					m.block_hash as old_block_hash,
					b.hash as new_block_hash,
					m.block_height
				FROM nbtc_minting m
				INNER JOIN btc_blocks b ON m.block_height = b.height
				JOIN nbtc_deposit_addresses a ON m.address_id = a.id
				JOIN nbtc_packages p ON a.package_id = p.id AND p.btc_network = b.network
				WHERE m.status = '${MintTxStatus.Minted}'
					AND m.block_height >= ?
					AND m.block_hash != b.hash`,
			)
			.bind(blockHeight)
			.all<ReorgedMintedTx>();
		return reorged.results ?? [];
	}

	//TODO: We need to query by network
	async getTxStatus(txId: string): Promise<MintTxStatus | null> {
		const result = await this.d1
			.prepare(`SELECT status FROM nbtc_minting WHERE tx_id = ? LIMIT 1`)
			.bind(txId)
			.first<{ status: MintTxStatus }>();
		return result?.status ?? null;
	}

	async updateNbtcTxsStatus(txIds: string[], status: MintTxStatus): Promise<void> {
		if (txIds.length === 0) {
			return;
		}
		const now = Date.now();
		const placeholders = txIds.map(() => "?").join(",");
		const updateStmt = this.d1
			.prepare(
				`UPDATE nbtc_minting SET status = ?, updated_at = ? WHERE tx_id IN (${placeholders})`,
			)
			.bind(status, now, ...txIds);
		await updateStmt.run();
	}

	async batchUpdateNbtcTxs(updates: NbtcTxUpdate[]): Promise<void> {
		const now = Date.now();
		const setMintedStmt = this.d1.prepare(
			`UPDATE nbtc_minting SET status = ?, sui_tx_id = ?, updated_at = ? WHERE tx_id = ? AND vout = ?`,
		);
		const setFailedStmt = this.d1.prepare(
			`UPDATE nbtc_minting SET status = ?, sui_tx_id = ?, retry_count = retry_count + 1, updated_at = ? WHERE tx_id = ? AND vout = ?`,
		);

		const statements = updates.map((p) => {
			if (p.status === MintTxStatus.Minted) {
				return setMintedStmt.bind(MintTxStatus.Minted, p.suiTxDigest, now, p.txId, p.vout);
			} else {
				return setFailedStmt.bind(
					MintTxStatus.MintFailed,
					p.suiTxDigest ?? null,
					now,
					p.txId,
					p.vout,
				);
			}
		});

		try {
			await this.d1.batch(statements);
		} catch (e) {
			logError({ msg: "Failed to update status", method: "CFStorage.batchUpdateNbtcTxs" }, e);
			throw e;
		}
	}

	async getConfirmingBlocks(): Promise<ConfirmingBlockInfo[]> {
		//NOTE: The `block_hash IS NOT NULL` check is a safety measure. While the `CONFIRMING`
		// status should guarantee a non-null block hash, transactions can be inserted
		// initially with a null hash (e.g., when broadcast but not yet mined).
		// This ensures we only try to verify blocks we know about.
		const blocksToVerify = await this.d1
			.prepare(
				`SELECT DISTINCT m.block_hash, p.btc_network as network
				FROM nbtc_minting m
				JOIN nbtc_deposit_addresses a ON m.address_id = a.id
				JOIN nbtc_packages p ON a.package_id = p.id
				WHERE m.status = '${MintTxStatus.Confirming}' AND m.block_hash IS NOT NULL`,
			)
			.all<ConfirmingBlockInfo>();
		return blocksToVerify.results ?? [];
	}

	async updateConfirmingTxsToReorg(blockHashes: string[]): Promise<void> {
		logger.warn({
			msg: "SPV Check: Detected reorged blocks. Updating transaction statuses.",
			reorgedBlockHashes: blockHashes,
		});
		const now = Date.now();
		const placeholders = blockHashes.map(() => "?").join(",");
		const updateStmt = this.d1
			.prepare(
				`UPDATE nbtc_minting SET status = '${MintTxStatus.Reorg}', updated_at = ? WHERE block_hash IN (${placeholders})`,
			)
			.bind(now, ...blockHashes);
		await updateStmt.run();
	}

	async getConfirmingTxs(): Promise<PendingTx[]> {
		const pendingTxs = await this.d1
			.prepare(
				`SELECT m.tx_id, m.block_hash, m.block_height, p.btc_network, a.deposit_address
				 FROM nbtc_minting m
				 JOIN nbtc_deposit_addresses a ON m.address_id = a.id
				 JOIN nbtc_packages p ON a.package_id = p.id
				 WHERE m.status = '${MintTxStatus.Confirming}'`,
			)
			.all<PendingTx>();
		return pendingTxs.results ?? [];
	}

	async finalizeNbtcTxs(txIds: string[]): Promise<void> {
		if (txIds.length === 0) {
			return;
		}
		const now = Date.now();
		const finalizeStmt = this.d1.prepare(
			`UPDATE nbtc_minting SET status = '${MintTxStatus.Finalized}', updated_at = ${now} WHERE tx_id = ?`,
		);
		const statements = txIds.map((txId) => finalizeStmt.bind(txId));
		await this.d1.batch(statements);
	}

	async getNbtcMintTx(txId: string): Promise<NbtcTxRow | null> {
		return this.d1
			.prepare(
				`SELECT m.*, p.nbtc_pkg, p.sui_network, p.btc_network
				 FROM nbtc_minting m
				 JOIN nbtc_deposit_addresses a ON m.address_id = a.id
				 JOIN nbtc_packages p ON a.package_id = p.id
				 WHERE m.tx_id = ?`,
			)
			.bind(txId)
			.first<NbtcTxRow>();
	}

	async getNbtcMintTxsBySuiAddr(suiAddress: string): Promise<NbtcTxRow[]> {
		const dbResult = await this.d1
			.prepare(
				`SELECT m.*, p.nbtc_pkg, p.sui_network, p.btc_network
				 FROM nbtc_minting m
				 JOIN nbtc_deposit_addresses a ON m.address_id = a.id
				 JOIN nbtc_packages p ON a.package_id = p.id
				 WHERE m.sui_recipient = ? ORDER BY m.created_at DESC`,
			)
			.bind(suiAddress)
			.all<NbtcTxRow>();
		return dbResult.results ?? [];
	}

	async registerBroadcastedNbtcTx(deposits: NbtcBroadcastedDeposit[]): Promise<void> {
		const now = Date.now();
		const insertStmt = this.d1.prepare(
			`INSERT OR IGNORE INTO nbtc_minting (tx_id, address_id, sender, vout, sui_recipient, amount_sats, status, created_at, updated_at, sui_tx_id, retry_count)
             VALUES (?, (SELECT a.id FROM nbtc_deposit_addresses a JOIN nbtc_packages p ON a.package_id = p.id WHERE p.btc_network = ? AND p.sui_network = ? AND p.nbtc_pkg = ? AND a.deposit_address = ?), ?, ?, ?, ?, '${MintTxStatus.Broadcasting}', ?, ?, NULL, 0)`,
		);

		const statements = deposits.map((deposit) =>
			insertStmt.bind(
				deposit.txId,
				deposit.btcNetwork,
				deposit.suiNetwork,
				deposit.nbtcPkg,
				deposit.depositAddress,
				deposit.sender,
				deposit.vout,
				deposit.suiRecipient,
				deposit.amountSats,
				now,
				now,
			),
		);
		try {
			await this.d1.batch(statements);
		} catch (e) {
			logError(
				{
					msg: "Failed to register broadcasted nBTC tx",
					method: "CFStorage.registerBroadcastedNbtcTx",
				},
				e,
			);
			throw e;
		}
	}

	async getNbtcMintTxsByBtcSender(btcAddress: string, network: BtcNet): Promise<NbtcTxRow[]> {
		const query = this.d1.prepare(`
            SELECT m.*, p.nbtc_pkg, p.sui_network, p.btc_network
            FROM nbtc_minting m
            JOIN nbtc_deposit_addresses a ON m.address_id = a.id
            JOIN nbtc_packages p ON a.package_id = p.id
            WHERE m.sender = ? AND p.btc_network = ?
            ORDER BY m.created_at DESC
        `);
		const dbResult = await query.bind(btcAddress, network).all<NbtcTxRow>();
		return dbResult.results ?? [];
	}
}
