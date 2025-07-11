<!-- markdownlint-disable MD013 -->

# Workers

Backend workers and indexers for BYield services

- [btcindexer](./packages/btcindexer/) - Bitcoin indexer for nBTC and SPV prover.

## Indexer Workflow

### Diagram

```mermaid
graph TD
    subgraph "Block Ingestion"
        A[[Relayer]] -- "Sends {height, rawBlockHex}" --> B(Indexer);
        B -- "Inserts/Overwrites" --> C[D1: processed_blocks];
        B -- "Inserts/Overwrites" --> D[KV: btc_blocks];
    end

    subgraph "Cron Job"
        E[[Cron Job]] -- "Reads 'to-do' list" --> C;
        E -- "Fetches raw block" --> D;
        E -- "Scans block, finds deposits" --> F(D1: nbtc_txs);
        E -- "Updates confirmations & handles reorgs" --> F;
    end

    F -- "Finalized TXs trigger minting" --> G[SUI Smart Contract];
```

### Components

- Relayer: An external service that acts as source of truth for Bitcoin blocks.
- Indexer (Cloudflare Worker): The service that listens for new blocks and runs periodic processing jobs.
- KV Store: Simple key-value store for raw Bitcoin block data.
- D1 Database: SQL database that stores structured data about blocks and nBTC deposit transactions.
  - `processed_blocks`: A queue of new blocks that need to be scanned.
  - `nbtc_txs`: The main ledger tracking the status of every nBTC deposit.

### 1. Block Ingestion Flow (push)

This is triggered every time the Relayer sends new block data to the indexer

1.  Block Submission: The Relayer sends a batch of new blocks (`height` and `rawBlockHex`).
2.  Reorg Handling: If the Relayer sends a block for a `height` that already exists in the `processed_blocks` table, the indexer overwrites it with the new one. This means a reorg happen on Bitcoin.
3.  Storage: The indexer saves the full raw block data to the KV store and adds (or updates) the light block info (`height`, `hash`) in the `processed_blocks` table in D1. This table acts as a "to-do" for the cron job.

### 2. Processing Flow (Cron Job)

A cron job runs on a fixed schedule (e.g., every 30 seconds)

1.  Deposit Discovery: The cron job reads a batch of unprocessed blocks from the `processed_blocks` queue. It fetches the full block data from KV and scans every transaction. If it finds a valid nBTC deposit, it saves the details to the `nbtc_txs` table with a status of `'confirming'`.
2.  Confirmation & Reorg Processing: The cron job then queries for all transactions in the `confirming` state.
    - Confirmation Update: It calculates the number of confirmations for each transaction based on the latest known block height. If a transaction has enough confirmations its status is updated to `finalized`.
    - Reorg Detection: It checks if the `block_hash` for a transaction's block height still exists in the `processed_blocks` table. If it doesn't (because it was overwritten during ingestion), the transaction has been reorged. Its status is changed to `reorg`. This transaction is now considered invalid, but we keep the record for indexing purposes.

### 3. nBTC Tx (Push)

To quickly handle UI nBTC transaction observability, BYield UI will push nBTC transaction, in order to let the indexer start monitoring it. This way UI will have the quick status about the TX, before the tx is added to the blockchain.

## Pracital information

### Dependencies

- node >= v22
- pnpm >= 10.12
- proper editorconfig mode setup in your editor!

### Quick Start

Firstly install the latest dependencies and link hooks

```sh
make setup-hooks
pnpm install
```

Run the wrangler dev server of all workers (with auto reload):

```sh
pnpm run dev
```

Watch for changes and automatically test:

```sh
pnpm run test
# To test only some packages
pnpm --filter pattern test
```

To apply migrations to the local Cloudflare env:

```sh
pnpm run db:migrate:local
```

### Using pnpm workspace

- [linking dependencies](https://pnpm.io/workspaces#publishing-workspace-packages)

### Typegen

Generate types for your Cloudflare bindings in `wrangler.toml`:

```sh
pnpm run typegen
```

You will need to rerun typegen whenever you make changes to `wrangler.toml`.

## Contributing

Participating in open source is often a highly collaborative experience. We’re encouraged to create in public view, and we’re incentivized to welcome contributions of all kinds from people around the world.

Check out [contributing repo](https://github.com/gonative-cc/contributig) for our guidelines & policies for how to contribute. Note: we require DCO! Thank you to all those who have contributed!

After cloning the repository, **make sure to run `make setup-hooks`**.
