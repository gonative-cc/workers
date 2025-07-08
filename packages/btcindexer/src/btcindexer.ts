import { ExtBlock, Transaction, Block } from "./btcblock";
import { address, networks } from "bitcoinjs-lib";

interface Deposit {
	vout: number;
	amountSats: number;
	suiRecipient: string;
}

export class Indexer {
	d1: D1Database; // SQL DB
	blocksDB: KVNamespace;
	nbtcTxDB: KVNamespace;
	nbtcScriptHex: string;
	fallbackAddr: string;

	constructor(env: Env, nbtcAddr: string, fallbackAddr: string, network: networks.Network) {
		this.d1 = env.DB;
		this.blocksDB = env.btc_blocks;
		this.nbtcTxDB = env.nbtc_txs;
		this.fallbackAddr = fallbackAddr;
		this.nbtcScriptHex = address.toOutputScript(nbtcAddr, network).toString("hex");
	}

	// returns number of processed and add blocks
	async putBlocks(blocks: ExtBlock[]): Promise<number> {
		if (!blocks || blocks.length === 0) {
			return 0;
		}
		const insertBlockStmt = this.d1.prepare(
			`INSERT INTO processed_blocks (height, hash) VALUES (?, ?)`
		);
		const putKVs = blocks.map((b) => this.blocksDB.put(b.getId(), b.raw));
		const putD1s = blocks.map((b) => insertBlockStmt.bind(b.height, b.getHash()));

		try {
			await Promise.all([...putKVs, this.d1.batch(putD1s)]);
		} catch (e) {
			console.error(`Failed to store one or more blocks in KV or D1:`, e);
			// TODO: decide what to do in the case where some blocks were saved and some not, prolly we need more granular error
			throw new Error(`Could not save all blocks data`);
		}
		return blocks.length;
	}

	async saveNbtcTx(tx: Transaction) {
		return this.nbtcTxDB.put(tx.getId(), tx.toBuffer());
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

	async scanNewBlocks(): Promise<void> {
		const blocksToProcess = await this.d1
			.prepare("SELECT height, hash FROM processed_blocks ORDER BY height ASC LIMIT 10")
			.all<{ height: number; hash: string }>();

		if (!blocksToProcess.results || blocksToProcess.results.length === 0) {
			return;
		}

		const nbtcTxStatements: D1PreparedStatement[] = [];

		const insertNbtcTxStmt = this.d1.prepare(
			"INSERT INTO nbtc_txs (tx_id, hash, height, vout, sui_recipient, amount_sats, status) VALUES (?, ?, ?, ?, ?, ?, ?)"
		);

		for (const blockInfo of blocksToProcess.results) {
			const rawBlockBuffer = await this.blocksDB.get(blockInfo.hash, {
				type: "arrayBuffer",
			});
			if (!rawBlockBuffer) {
				continue;
			}
			const block = Block.fromBuffer(Buffer.from(rawBlockBuffer));

			for (const tx of block.transactions ?? []) {
				const deposits = this.findNbtcDeposits(tx);
				for (const deposit of deposits) {
					nbtcTxStatements.push(
						insertNbtcTxStmt.bind(
							tx.getId(),
							blockInfo.hash,
							blockInfo.height,
							deposit.vout,
							deposit.suiRecipient,
							deposit.amountSats,
							"confirming"
						)
					);
				}
			}
		}

		// TODO: what happens if the array is empty?
		await this.d1.batch(nbtcTxStatements);

		const heightsToDelete = blocksToProcess.results.map((r) => r.height);
		const deleteQuery = `DELETE FROM processed_blocks WHERE height IN (${heightsToDelete.join(
			","
		)})`;
		await this.d1.prepare(deleteQuery).run();
	}

	findNbtcDeposits(tx: Transaction): Deposit[] {
		const deposits: Deposit[] = [];
		let suiRecipient: string | null = null;

		for (const vout of tx.outs) {
			// OP_RETURN = 0x6a
			if (vout.script[0] === 0x6a) {
				suiRecipient = vout.script.subarray(2).toString();
				break; // valid tx should have only one OP_RETURN
			}
		}
		for (let i = 0; i < tx.outs.length; i++) {
			const vout = tx.outs[i];
			if (vout.script.toString("hex").includes(this.nbtcScriptHex)) {
				deposits.push({
					vout: i,
					amountSats: Number(vout.value),
					suiRecipient: suiRecipient || this.fallbackAddr,
				});
			}
		}
		return deposits;
	}
}
