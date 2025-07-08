import { ExtBlock, Tx, Transaction } from './btcblock';

interface Depoist {
	amountSats: number,
	suiRecipient: string | null,
}

export class Indexer {
	d1: D1Database; // SQL DB
	blocksDB: KVNamespace;
	nbtcTxDB: KVNamespace;
	nbtcAddr: string;

	constructor(env: Env, nbtcAddr: string) {
		this.d1 = env.DB;
		this.blocksDB = env.btc_blocks;
		this.nbtcTxDB = env.nbtc_txs;
		this.nbtcAddr = nbtcAddr;
	}

	// returns number of processed and add blocks
	async putBlocks(blocks: ExtBlock[]): Promise<number> {
		if (!blocks || blocks.length === 0) {
			return 0;
    }
    for (const b of blocks) {
		const insertBlockStmt = this.d1.prepare(
			`INSERT INTO processed_blocks (height, block_id) VALUES (?, ?)`,
		);
		const putKVs = blocks.map((b) => this.blocksDB.put(b.getId(), b.raw));
		// TODO: the height is not part of the block itself. Probably we will need to send it from the relayer, sending blocks {height, raw}
		const putD1s = blocks.map((b) => insertBlockStmt.bind(0, b.getHash()));
		try {
			await Promise.all([...putKVs, this.d1.batch(putD1s)]);
		} catch (e) {
			console.error(`Failed to store one or more blocks in KV or D1:`, e);
			// TODO: decide what to do in the case where some blocks were saved and some not, prolly we need more granular error
			throw new Error(`Could not save all blocks data`);
		}
		// TODO: parse the raw blocks and scan them for NBTC transactions, then insert them into the nBTC txs table.
		// TODO: index nBTC txs
		// TODO: save light blocks in d1
		// TODO: index nBTC txs in d1
		// TODO: save raw nBTC txs in DB
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
			.prepare('SELECT height, hash FROM processed_blocks ORDER BY height ASC LIMIT 10')
			.all<{ height: number, hash: string }>();

		if (!blocksToProcess.results || blocksToProcess.results.length === 0) {
			return;
		}

		const nbtcTxStatements: D1PreparedStatement[] = [];

		const insertNbtcTxStmt = this.d1.prepare(
			'INSERT INTO nbtc_txs (tx_id, block_hash, block_height, sender_address, sui_recipient, amount_sats, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
		);

		for (const blockInfo of blocksToProcess.results) {
			const rawBlockBuffer = await this.blocksDB.get(blockInfo.hash, { type: 'arrayBuffer' });
			if (!rawBlockBuffer) {
				continue;
			}
			const block = Block.fromBuffer(Buffer.from(rawBlockBuffer));
			// TODO: Implement the transaction scanning logic here.

			for (const tx of block.transactions ?? []) {
				const depositInfo = this.findNbtcDeposit(tx);

				if (depositInfo) {
					//TODO: How to get the sender address?
					const senderAddress = 'dummy_address';

					nbtcTxStatements.push(
						insertNbtcTxStmt.bind(
							tx.getId(),
							blockInfo.hash,
							blockInfo.height,
							senderAddress,
							depositInfo.suiRecipient,
							depositInfo.amountSats,
							'confirming'
						)
					);
				}
			}
		}

		// TODO: what happens if the array is empty?
		await this.d1.batch(nbtcTxStatements);

		const heightsToDelete = blocksToProcess.results.map(r => r.height);
		const deleteQuery = `DELETE FROM processed_blocks WHERE height IN (${heightsToDelete.join(',')})`;
		await this.d1.prepare(deleteQuery).run();
	}

	findNbtcDeposit(tx: Transaction): Depoist | null {
		let totalAmountSats = 0;
		// TODO: handle empty OP_RETURN
		let suiRecipient: string | null = null;

		for (const vout of tx.outs) {
			const script = vout.script;

			// OP_RETURN = 0x6a
			if (script[0] === 0x6a) {
				suiRecipient = script.subarray(2).toString();
			}
			// TODO: check how to handle all types P2PKH, P2SH, P2WPKH, etc.
			else if (script.toString('hex').includes(this.nbtcAddr)) {
				totalAmountSats += Number(vout.value);
			}
		}

		if (totalAmountSats > 0) {
			return { amountSats: totalAmountSats, suiRecipient };
		}

		return null;
	}
}
