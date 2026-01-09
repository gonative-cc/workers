import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { Miniflare } from "miniflare";
import { fetchNbtcAddresses, fetchPackageConfigs } from "./storage";
import { CFStorage as CFStorageImpl } from "./cf-storage";
import { MintTxStatus, InsertBlockStatus } from "./models";
import { BtcNet, type BlockQueueRecord } from "@gonative-cc/lib/nbtc";
import { initDb } from "./db.test";
import { toSuiNet } from "@gonative-cc/lib/nsui";

let mf: Miniflare;

beforeAll(async () => {
	mf = new Miniflare({
		script: "",
		modules: true,
		d1Databases: ["DB"],
		kvNamespaces: ["BtcBlocks", "nbtc_txs"],
		d1Persist: false,
		kvPersist: false,
		cachePersist: false,
	});
});

afterAll(async () => {
	await mf.dispose();
});

beforeEach(async () => {
	const db = await mf.getD1Database("DB");
	await initDb(db);
});

afterEach(async () => {
	const db = await mf.getD1Database("DB");
	const tables = [
		"btc_blocks",
		"nbtc_minting",
		"nbtc_withdrawal",
		"setups",
		"nbtc_deposit_addresses",
	];
	const dropStms = tables.map((t) => `DROP TABLE IF EXISTS ${t};`).join(" ");
	await db.exec(dropStms);
});

describe("Storage Helper Functions", () => {
	it("fetchPackageConfigs should return active packages", async () => {
		const db = await mf.getD1Database("DB");
		await db
			.prepare(
				`
            INSERT INTO setups (id, btc_network, sui_network, nbtc_pkg, nbtc_contract, lc_pkg, lc_contract, sui_fallback_address, is_active)
            VALUES
            (1, 'regtest', 'devnet', '0xPkg1', '0xContract1', '0xLC1', '0xLCC1', '0xFallback1', 1),
            (2, 'regtest', 'devnet', '0xPkg2', '0xContract2', '0xLC2', '0xLCC2', '0xFallback2', 0)
        `,
			)
			.run();

		const configs = await fetchPackageConfigs(db);
		expect(configs.length).toBe(1);
		expect(configs[0]!.nbtc_pkg).toBe("0xPkg1");
	});

	it("fetchNbtcAddresses should return active addresses mapped to packages", async () => {
		const db = await mf.getD1Database("DB");
		await db
			.prepare(
				`
            INSERT INTO setups (id, btc_network, sui_network, nbtc_pkg, nbtc_contract, lc_pkg, lc_contract, sui_fallback_address, is_active)
            VALUES (1, 'regtest', 'devnet', '0xPkg1', '0xContract1', '0xLC1', '0xLCC1', '0xFallback1', 1)
        `,
			)
			.run();
		await db
			.prepare(
				`
            INSERT INTO nbtc_deposit_addresses (setup_id, deposit_address, is_active)
            VALUES (1, 'bcrt1qAddress1', 1), (1, 'bcrt1qAddress2', 0)
        `,
			)
			.run();

		const addrMap = await fetchNbtcAddresses(db);
		expect(addrMap.size).toBe(2); // we track deposits for both active and inactive addresses
		expect(addrMap.has("bcrt1qAddress1")).toBe(true);
		expect(addrMap.get("bcrt1qAddress1")!.is_active).toBe(true);
		expect(addrMap.has("bcrt1qAddress2")).toBe(true);
		expect(addrMap.get("bcrt1qAddress2")?.is_active).toBe(false);
	});
});

describe("CFStorage", () => {
	let storage: CFStorageImpl;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let env: any;

	beforeEach(async () => {
		env = await mf.getBindings();
		storage = new CFStorageImpl(env.DB, env.BtcBlocks, env.nbtc_txs);

		const db = env.DB;
		await db
			.prepare(
				`
            INSERT INTO setups (id, btc_network, sui_network, nbtc_pkg, nbtc_contract, lc_pkg, lc_contract, sui_fallback_address, is_active)
            VALUES (1, 'regtest', 'devnet', '0xPkg1', '0xContract1', '0xLC1', '0xLCC1', '0xFallback1', 1)
        `,
			)
			.run();
		await db
			.prepare(
				`
            INSERT INTO nbtc_deposit_addresses (id, setup_id, deposit_address, is_active)
            VALUES (10, 1, 'bcrt1qAddress1', 1)
        `,
			)
			.run();
	});

	it("getDepositAddresses should return addresses for specific network", async () => {
		const addrs = await storage.getDepositAddresses(BtcNet.REGTEST);
		expect(addrs).toContain("bcrt1qAddress1");

		const mainnetAddrs = await storage.getDepositAddresses(BtcNet.MAINNET);
		expect(mainnetAddrs.length).toBe(0);
	});

	describe("Block Operations", () => {
		it("insertBlockInfo should insert new block", async () => {
			const block: BlockQueueRecord = {
				hash: "0000hash1",
				height: 100,
				network: BtcNet.REGTEST,
				timestamp_ms: 1000,
			};
			const result = await storage.insertBlockInfo(block);
			expect(result).toBe(InsertBlockStatus.Inserted);

			const saved = await storage.getBlockHash(100, BtcNet.REGTEST);
			expect(saved).toBe("0000hash1");
		});

		it("insertBlockInfo should update if newer timestamp", async () => {
			await storage.insertBlockInfo({
				hash: "0000hashOld",
				height: 100,
				network: BtcNet.REGTEST,
				timestamp_ms: 1000,
			});

			const result = await storage.insertBlockInfo({
				hash: "0000hashNew",
				height: 100,
				network: BtcNet.REGTEST,
				timestamp_ms: 2000,
			});
			expect(result).toBe(InsertBlockStatus.Updated);
			const saved = await storage.getBlockHash(100, BtcNet.REGTEST);
			expect(saved).toBe("0000hashNew");
		});

		it("insertBlockInfo should ignore if older timestamp", async () => {
			await storage.insertBlockInfo({
				hash: "0000hashNew",
				height: 100,
				network: BtcNet.REGTEST,
				timestamp_ms: 2000,
			});

			const result = await storage.insertBlockInfo({
				hash: "0000hashOld",
				height: 100,
				network: BtcNet.REGTEST,
				timestamp_ms: 1000,
			});
			expect(result).toBe(InsertBlockStatus.Skipped);
			const saved = await storage.getBlockHash(100, BtcNet.REGTEST);
			expect(saved).toBe("0000hashNew");
		});

		it("markBlockAsProcessed should update is_scanned", async () => {
			await storage.insertBlockInfo({
				hash: "0000hash1",
				height: 100,
				network: BtcNet.REGTEST,
				timestamp_ms: 1000,
			});

			let blocks = await storage.getBlocksToProcess(10);
			expect(blocks.length).toBe(1);

			await storage.markBlockAsProcessed("0000hash1", BtcNet.REGTEST);

			blocks = await storage.getBlocksToProcess(10);
			expect(blocks.length).toBe(0);
		});

		it("getLatestBlockHeight should return max height", async () => {
			await storage.insertBlockInfo({
				hash: "h1",
				height: 100,
				network: BtcNet.REGTEST,
				timestamp_ms: 1,
			});
			await storage.insertBlockInfo({
				hash: "h2",
				height: 102,
				network: BtcNet.REGTEST,
				timestamp_ms: 2,
			});

			const max = await storage.getLatestBlockHeight(BtcNet.REGTEST);
			expect(max).toBe(102);
		});

		it("KV operations for ChainTip and Block", async () => {
			await storage.setChainTip(500, BtcNet.REGTEST);
			expect(await storage.getChainTip(BtcNet.REGTEST)).toBe(500);

			await env.BtcBlocks.put("hash123", new Uint8Array([1, 2, 3]));
			const blockData = await storage.getBlock("hash123");
			expect(blockData).not.toBeNull();
			expect(new Uint8Array(blockData!)).toEqual(new Uint8Array([1, 2, 3]));
		});
	});

	describe("Transaction Operations", () => {
		const txBase = {
			txId: "tx1",
			btcNetwork: BtcNet.REGTEST,
			suiNetwork: toSuiNet("devnet"),
			nbtcPkg: "0xPkg1",
			depositAddress: "bcrt1qAddress1",
			sender: "sender1",
			vout: 0,
			blockHash: "blockHash1",
			blockHeight: 100,
			suiRecipient: "0xSui1",
			amount: 5000,
		};

		it("insertOrUpdateNbtcTxs should insert transaction", async () => {
			await storage.insertOrUpdateNbtcTxs([txBase]);

			const tx = await storage.getNbtcMintTx("tx1");
			expect(tx).not.toBeNull();
			expect(tx!.status).toBe(MintTxStatus.Confirming);
			expect(tx!.amount).toBe(5000);
		});

		it("getNbtcMintCandidates should return correct candidates", async () => {
			await storage.insertOrUpdateNbtcTxs([txBase]);
			await storage.finalizeNbtcTxs(["tx1"]);

			const candidates = await storage.getNbtcMintCandidates(3);
			expect(candidates.length).toBe(1);
			expect(candidates[0]!.tx_id).toBe("tx1");
		});

		it("batchUpdateNbtcTxs should update statuses", async () => {
			await storage.insertOrUpdateNbtcTxs([txBase]);

			await storage.batchUpdateNbtcTxs([
				{
					txId: "tx1",
					vout: 0,
					status: MintTxStatus.Minted,
					suiTxDigest: "digest1",
				},
			]);

			const tx = await storage.getNbtcMintTx("tx1");
			expect(tx!.status).toBe(MintTxStatus.Minted);
			expect(tx!.sui_tx_id).toBe("digest1");
		});

		it("getReorgedMintedTxs should detect reorg", async () => {
			await storage.insertOrUpdateNbtcTxs([txBase]);
			await storage.batchUpdateNbtcTxs([
				{
					txId: "tx1",
					vout: 0,
					status: MintTxStatus.Minted,
					suiTxDigest: "digest1",
				},
			]);

			// new block at the same height with different hash (reorg)
			await storage.insertBlockInfo({
				hash: "blockHash2_Reorg",
				height: 100,
				network: BtcNet.REGTEST,
				timestamp_ms: 2000,
			});

			const reorged = await storage.getReorgedMintedTxs(100);
			expect(reorged.length).toBe(1);
			expect(reorged[0]!.tx_id).toBe("tx1");
			expect(reorged[0]!.old_block_hash).toBe("blockHash1");
			expect(reorged[0]!.new_block_hash).toBe("blockHash2_Reorg");
		});

		it("registerBroadcastedNbtcTx should insert with Broadcasting status", async () => {
			await storage.registerBroadcastedNbtcTx([
				{
					txId: "txBroadcast",
					btcNetwork: BtcNet.REGTEST,
					suiNetwork: "devnet",
					nbtcPkg: "0xPkg1",
					depositAddress: "bcrt1qAddress1",
					sender: "sender2",
					vout: 1,
					suiRecipient: "0xSui2",
					amount: 1000,
				},
			]);

			const tx = await storage.getNbtcMintTx("txBroadcast");
			expect(tx!.status).toBe(MintTxStatus.Broadcasting);
		});

		it("getConfirmingBlocks should return unique blocks for confirming txs", async () => {
			await storage.insertOrUpdateNbtcTxs([txBase]);
			// another tx in same block
			const tx2 = { ...txBase, txId: "tx2", vout: 1 };
			await storage.insertOrUpdateNbtcTxs([tx2]);

			const blocks = await storage.getConfirmingBlocks();
			expect(blocks.length).toBe(1);
			expect(blocks[0]!.block_hash).toBe(txBase.blockHash);
		});

		it("getMintedTxs should return minted txs after specific height", async () => {
			await storage.insertOrUpdateNbtcTxs([txBase]);
			await storage.updateNbtcTxsStatus(["tx1"], MintTxStatus.Minted);

			const minted = await storage.getMintedTxs(90);
			expect(minted.length).toBe(1);
			expect(minted[0]!.tx_id).toBe("tx1");

			const mintedHigh = await storage.getMintedTxs(101);
			expect(mintedHigh.length).toBe(0);
		});

		it("updateNbtcTxsStatus should update single status", async () => {
			await storage.insertOrUpdateNbtcTxs([txBase]);
			await storage.updateNbtcTxsStatus(["tx1"], MintTxStatus.MintFailed);

			const tx = await storage.getNbtcMintTx("tx1");
			expect(tx!.status).toBe(MintTxStatus.MintFailed);
		});

		it("updateConfirmingTxsToReorg should mark confirming txs as reorg", async () => {
			await storage.insertOrUpdateNbtcTxs([txBase]);

			await storage.updateConfirmingTxsToReorg([txBase.blockHash]);

			const tx = await storage.getNbtcMintTx("tx1");
			expect(tx!.status).toBe(MintTxStatus.Reorg);
		});

		it("getConfirmingTxs should return confirming transactions", async () => {
			await storage.insertOrUpdateNbtcTxs([txBase]);
			const confirming = await storage.getConfirmingTxs();
			expect(confirming.length).toBe(1);
			expect(confirming[0]!.tx_id).toBe("tx1");
		});

		it("getNbtcMintTxsBySuiAddr should return txs for recipient", async () => {
			await storage.insertOrUpdateNbtcTxs([txBase]);
			const txs = await storage.getNbtcMintTxsBySuiAddr(txBase.suiRecipient);
			expect(txs.length).toBe(1);
			expect(txs[0]!.tx_id).toBe("tx1");
		});

		it("getNbtcMintTxsByBtcSender should return txs for sender", async () => {
			await storage.insertOrUpdateNbtcTxs([txBase]);
			const txs = await storage.getNbtcMintTxsByBtcSender(txBase.sender, BtcNet.REGTEST);
			expect(txs.length).toBe(1);
			expect(txs[0]!.tx_id).toBe("tx1");
		});
	});
});
