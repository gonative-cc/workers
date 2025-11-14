import { toSerializableError } from "./errutils";
import type { BlockInfo, FinalizedTxRow, NbtcTxRow, PendingTx } from "./models";
import { BlockStatus, TxStatus } from "./models";
import type { Storage } from "./storage";

export class CFStorage implements Storage {
	private d1: D1Database;
	private blocksDB: KVNamespace;
	private nbtcTxDB: KVNamespace;

	constructor(d1: D1Database, blocksDB: KVNamespace, nbtcTxDB: KVNamespace) {
		this.d1 = d1;
		this.blocksDB = blocksDB;
		this.nbtcTxDB = nbtcTxDB;
	}

	async getDepositAddresses(btcNetwork: string): Promise<string[]> {
		try {
			const { results } = await this.d1
				.prepare("SELECT btc_address FROM nbtc_addresses WHERE btc_network = ?")
				.bind(btcNetwork)
				.all<{ btc_address: string }>();
			return results ? results.map((r) => r.btc_address) : [];
		} catch (e) {
			console.error({
				msg: "Failed to fetch deposit addresses from D1",
				error: toSerializableError(e),
				btcNetwork,
			});
			throw e;
		}
	}

	async insertBlockFromQueue(message: {
		hash: string;
		height: number;
		network: string;
	}): Promise<void> {
		const now = Date.now();
		const insertStmt = this.d1.prepare(
			`INSERT INTO btc_blocks (hash, height, network, inserted_at) VALUES (?, ?, ?, ?)
			 ON CONFLICT(height, network) DO UPDATE SET
			   hash = excluded.hash,
			   inserted_at = excluded.inserted_at,
			   status = '${BlockStatus.NEW}'
			 WHERE btc_blocks.hash IS NOT excluded.hash`,
		);
		try {
			await insertStmt.bind(message.hash, message.height, message.network, now).run();
		} catch (e) {
			console.error({
				msg: "Failed to insert block from queue message",
				error: toSerializableError(e),
				message,
			});
			throw e;
		}
	}

	async updateBlockStatus(hash: string, network: string, status: string): Promise<void> {
		const now = Date.now();
		const updateStmt = `UPDATE btc_blocks SET status = ?, processed_at = ? WHERE hash = ? AND network = ?`;
		try {
			await this.d1.prepare(updateStmt).bind(status, now, hash, network).run();
			console.debug({
				msg: `Marked block as ${status}`,
				hash,
				network,
			});
		} catch (e) {
			console.error({
				msg: `Failed to mark block as ${status}`,
				error: toSerializableError(e),
			});
			throw e;
		}
	}

	async getLatestBlockHeight(): Promise<number | null> {
		const result = await this.d1
			.prepare("SELECT MAX(height) as height FROM btc_blocks")
			.first<{ height: number | null }>();
		return result?.height ?? null;
	}

	async getChainTip(): Promise<number | null> {
		const latestHeightStr = await this.blocksDB.get("chain_tip");
		return latestHeightStr ? parseInt(latestHeightStr, 10) : 0;
	}

	async setChainTip(height: number): Promise<void> {
		await this.blocksDB.put("chain_tip", height.toString());
	}

	async getBlock(hash: string): Promise<ArrayBuffer | null> {
		return this.blocksDB.get(hash, { type: "arrayBuffer" });
	}

	async getBlockInfo(height: number, network: string): Promise<{ hash: string } | null> {
		return this.d1
			.prepare("SELECT hash FROM btc_blocks WHERE height = ? AND network = ?")
			.bind(height, network)
			.first<{ hash: string }>();
	}

	async insertOrUpdateNbtcTxs(
		txs: {
			txId: string;
			vout: number;
			blockHash: string;
			blockHeight: number;
			suiRecipient: string;
			amountSats: number;
			network: string;
			nbtc_pkg: string;
			sui_network: string;
		}[],
	): Promise<void> {
		if (txs.length === 0) {
			return;
		}
		const now = Date.now();
		const insertOrUpdateNbtcTxStmt = this.d1.prepare(
			`INSERT INTO nbtc_minting (tx_id, vout, block_hash, block_height, sui_recipient, amount_sats, status, created_at, updated_at, network, nbtc_pkg, sui_network)
             VALUES (?, ?, ?, ?, ?, ?, '${TxStatus.CONFIRMING}', ?, ?, ?, ?, ?)
             ON CONFLICT(tx_id, vout) DO UPDATE SET
                block_hash = excluded.block_hash,
                block_height = excluded.block_height,
                status = '${TxStatus.CONFIRMING}',
                updated_at = excluded.updated_at,
				network = excluded.network,
				nbtc_pkg = excluded.nbtc_pkg,
				sui_network = excluded.sui_network`,
		);
		const statements = txs.map((tx) =>
			insertOrUpdateNbtcTxStmt.bind(
				tx.txId,
				tx.vout,
				tx.blockHash,
				tx.blockHeight,
				tx.suiRecipient,
				tx.amountSats,
				now,
				now,
				tx.network,
				tx.nbtc_pkg,
				tx.sui_network,
			),
		);
		try {
			await this.d1.batch(statements);
		} catch (e) {
			console.error({
				msg: "Cron: Failed to insert nBTC transactions",
				error: toSerializableError(e),
			});
			throw e;
		}
	}

	async getFinalizedTxs(maxRetries: number): Promise<FinalizedTxRow[]> {
		const finalizedTxs = await this.d1
			.prepare(
				`SELECT tx_id, vout, block_hash, block_height, retry_count, nbtc_pkg, sui_network FROM nbtc_minting WHERE (status = '${TxStatus.FINALIZED}' OR (status = '${TxStatus.MINT_FAILED}' AND retry_count <= ?)) AND status != '${TxStatus.FINALIZED_REORG}'`,
			)
			.bind(maxRetries)
			.all<FinalizedTxRow>();
		return finalizedTxs.results ?? [];
	}

	async updateTxsStatus(txIds: string[], status: TxStatus): Promise<void> {
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

	async batchUpdateNbtcTxs(
		updates: { tx_id: string; vout: number; status: TxStatus; suiTxDigest?: string }[],
	): Promise<void> {
		const now = Date.now();
		const setMintedStmt = this.d1.prepare(
			`UPDATE nbtc_minting SET status = ?, sui_tx_id = ?, updated_at = ? WHERE tx_id = ? AND vout = ?`,
		);
		const setFailedStmt = this.d1.prepare(
			`UPDATE nbtc_minting SET status = ?, retry_count = retry_count + 1, updated_at = ? WHERE tx_id = ? AND vout = ?`,
		);

		const statements = updates.map((p) => {
			if (p.status === TxStatus.MINTED) {
				return setMintedStmt.bind(TxStatus.MINTED, p.suiTxDigest, now, p.tx_id, p.vout);
			} else {
				return setFailedStmt.bind(TxStatus.MINT_FAILED, now, p.tx_id, p.vout);
			}
		});

		try {
			await this.d1.batch(statements);
		} catch (e) {
			console.error({
				msg: "Failed to update status",
				error: toSerializableError(e),
			});
			throw e;
		}
	}

	async getConfirmingBlocks(): Promise<{ block_hash: string }[]> {
		//NOTE: The `block_hash IS NOT NULL` check is a safety measure. While the `CONFIRMING`
		// status should guarantee a non-null block hash, transactions can be inserted
		// initially with a null hash (e.g., when broadcast but not yet mined).
		// This ensures we only try to verify blocks we know about.
		const blocksToVerify = await this.d1
			.prepare(
				`SELECT DISTINCT block_hash FROM nbtc_minting WHERE status = '${TxStatus.CONFIRMING}' AND block_hash IS NOT NULL`,
			)
			.all<{ block_hash: string }>();
		return blocksToVerify.results ?? [];
	}

	async updateConfirmingTxsToReorg(blockHashes: string[]): Promise<void> {
		const now = Date.now();
		const placeholders = blockHashes.map(() => "?").join(",");
		const updateStmt = this.d1
			.prepare(
				`UPDATE nbtc_minting SET status = '${TxStatus.REORG}', updated_at = ? WHERE block_hash IN (${placeholders})`,
			)
			.bind(now, ...blockHashes);
		await updateStmt.run();
	}

	async getConfirmingTxs(): Promise<PendingTx[]> {
		const pendingTxs = await this.d1
			.prepare(
				`SELECT tx_id, block_hash, block_height, network FROM nbtc_minting WHERE status = '${TxStatus.CONFIRMING}'`,
			)
			.all<PendingTx>();
		return pendingTxs.results ?? [];
	}

	async finalizeTxs(txIds: string[]): Promise<void> {
		if (txIds.length === 0) {
			return;
		}
		const now = Date.now();
		const finalizeStmt = this.d1.prepare(
			`UPDATE nbtc_minting SET status = '${TxStatus.FINALIZED}', updated_at = ${now} WHERE tx_id = ?`,
		);
		const statements = txIds.map((txId) => finalizeStmt.bind(txId));
		await this.d1.batch(statements);
	}

	async getStatusByTxid(txid: string): Promise<NbtcTxRow | null> {
		return this.d1
			.prepare("SELECT * FROM nbtc_minting WHERE tx_id = ?")
			.bind(txid)
			.first<NbtcTxRow>();
	}

	async getStatusBySuiAddress(suiAddress: string): Promise<NbtcTxRow[]> {
		const dbResult = await this.d1
			.prepare("SELECT * FROM nbtc_minting WHERE sui_recipient = ? ORDER BY created_at DESC")
			.bind(suiAddress)
			.all<NbtcTxRow>();
		return dbResult.results ?? [];
	}

	async registerBroadcastedNbtcTx(
		deposits: {
			txId: string;
			vout: number;
			suiRecipient: string;
			amountSats: number;
			nbtc_pkg: string;
			sui_network: string;
		}[],
	): Promise<void> {
		const now = Date.now();
		const insertStmt = this.d1.prepare(
			`INSERT OR IGNORE INTO nbtc_minting (tx_id, vout, sui_recipient, amount_sats, status, created_at, updated_at, nbtc_pkg, sui_network)
         VALUES (?, ?, ?, ?, '${TxStatus.BROADCASTING}', ?, ?, ?, ?)`,
		);

		const statements = deposits.map((deposit) =>
			insertStmt.bind(
				deposit.txId,
				deposit.vout,
				deposit.suiRecipient,
				deposit.amountSats,
				now,
				now,
				deposit.nbtc_pkg,
				deposit.sui_network,
			),
		);
		await this.d1.batch(statements);
	}

	async getDepositsBySender(btcAddress: string): Promise<NbtcTxRow[]> {
		const query = this.d1.prepare(`
            SELECT m.* FROM nbtc_minting m
            JOIN nbtc_sender_deposits s ON m.tx_id = s.tx_id
            WHERE s.sender = ?
            ORDER BY m.created_at DESC
        `);
		const dbResult = await query.bind(btcAddress).all<NbtcTxRow>();
		return dbResult.results ?? [];
	}

	async insertSenderDeposits(senders: { txId: string; sender: string }[]): Promise<void> {
		if (senders.length === 0) {
			return;
		}
		const insertStmt = this.d1.prepare(
			"INSERT OR IGNORE INTO nbtc_sender_deposits (tx_id, sender) VALUES (?, ?)",
		);
		const statements = senders.map((s) => insertStmt.bind(s.txId, s.sender));
		await this.d1.batch(statements);
	}
}
