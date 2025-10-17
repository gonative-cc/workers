# BTCIndexer Worker Documentation

This document provides an overview of the `btcindexer` worker, its architecture, state machine, and API endpoints.

## 1. Overview

The `btcindexer` worker is a Cloudflare Worker responsible for monitoring the Bitcoin blockchain for nBTC deposits, processing them, and coordinating the minting of nBTC tokens on the Sui blockchain.

## 2. Architecture

```mermaid
graph TD
    subgraph "External Systems"
        UI[bYield UI]
        Relayer[Bitcoin Relayer]
        Bitcoin[Bitcoin Network]
        Sui[Sui Network]
    end

    subgraph "BTCIndexer Worker"
        Router[Router]
        Indexer[Indexer Logic]
        SuiClient[Sui Client]
        DB[D1 Database]
        BlockStore[KV Block Storage]
    end

    UI -- "1. POST /nbtc (txHex)" --> Router
    Relayer -- "2. PUT /bitcoin/blocks" --> Router
    Relayer -- "Gets blocks from" --> Bitcoin

    Router --> Indexer

    Indexer -- "Stores/retrieves tx state" --> DB
    Indexer -- "Stores/retrieves raw blocks" --> BlockStore
    Indexer -- "Uses" --> SuiClient

    SuiClient -- "3. Verifies blocks" --> Sui
    SuiClient -- "4. Mints nBTC" --> Sui
```

The worker is composed of several key components:

- **Main Worker (`src/index.ts`):** The entry point for all incoming requests. It handles HTTP requests, and scheduled cron jobs, and delegates tasks to the appropriate modules.
- **Indexer (`src/btcindexer.ts`):** The core logic for processing Bitcoin blocks and transactions. It identifies nBTC deposits, tracks their confirmation status, and manages the minting process.
- **Router (`src/router.ts`):** Defines the API endpoints and routes incoming requests to the correct handlers.
- **Sui Client (`src/sui_client.ts`):** Interacts with the Sui blockchain to mint nBTC tokens.
- **Storage (`src/storage.ts`, `src/cf-storage.ts`):** Manages data persistence using Cloudflare D1 and KV stores.

## 3. State Machine

The `btcindexer` tracks the state of nBTC minting transactions as they progress through the system. The state is stored in the `nbtc_minting` table in the D1 database.

The `status` field of a transaction can have one of the following values:

- `broadcasting`: The deposit transaction has been broadcast to the Bitcoin network, but has not yet been included in a block.
- `confirming`: The deposit tx has been found in a Bitcoin block but does not yet have enough confirmations.
- `finalized`: The tx has reached the required confirmation depth and is ready to be minted.
- `minting`: The minting process on the Sui blockchain has been initiated.
- `minted`: The nBTC has been successfully minted on the SUI network.
- `reorg`: A blockchain reorg was detected while the tx was in the 'confirming' state. The tx block is no longer part of the canonical chain.
- `finalized-reorg`: An edge-case status indicating that a tx was marked 'finalized', but was later discovered to be on an orphaned (re-org deeper than the confirmation depth).
- `finalized-failed`: An attempt to mint a finalized tx failed, but it may be retried.

## 4. API Endpoints

The following are the primary API endpoints exposed by the `btcindexer` worker.

### `PUT /bitcoin/blocks`

Pushes new Bitcoin blocks to the indexer for processing. This endpoint is intended to be used by a relayer service.

- **Request Body:** A msgpack-encoded array of block data.
- **Response:**
  - `200 OK`: `{ "inserted": <number> }`

### `POST /nbtc`

Registers a new nBTC deposit transaction that has been broadcasted to the Bitcoin network.

- **Request Body:**
  ```json
  {
    "txHex": "<string>"
  }
  ```
- **Response:**
  - `200 OK`: `{ "success": true, "tx_id": "<string>", "registered_deposits": <number> }`
  - `400 Bad Request`: If the request body is invalid or the transaction fails to be registered.

### `GET /nbtc/:txid`

Retrieves the status of a specific nBTC deposit transaction by its Bitcoin transaction ID.

- **URL Parameters:**
  - `txid`: The Bitcoin transaction ID.
- **Response:**
  - `200 OK`: A `TxStatusResp` object.
    ```json
    {
      "btc_tx_id": "<string>",
      "status": "<TxStatus>",
      "block_height": "<number | null>",
      "confirmations": "<number>",
      "sui_recipient": "<string>",
      "amount_sats": "<number>",
      "sui_tx_id": "<string | null>"
    }
    ```
  - `404 Not Found`: If the transaction is not found.

### `GET /nbtc`

Retrieves the status of all nBTC deposit transactions for a given Sui recipient address.

- **Query Parameters:**
  - `sui_recipient`: The Sui address of the recipient.
- **Response:**
  - `200 OK`: An array of `TxStatusResp` objects.
  - `400 Bad Request`: If the `sui_recipient` parameter is missing or invalid.

### `GET /bitcoin/latest-height`

Returns the height of the latest Bitcoin block processed by the indexer.

- **Response:**
  - `200 OK`: `{ "height": <number | null> }`

### `GET /bitcoin/deposits/`

Retrieves all deposit transactions for a given sender address.

- **Query Parameters:**
  - `sender`: The sender address.
- **Response:**
  - `200 OK`: An array of `TxStatusResp` objects.
  - `400 Bad Request`: If the `sender` parameter is missing or invalid.

## 5. Cron Job

The worker runs a scheduled cron job every minute (`* * * * *`) to perform the following tasks:

- Scan for new blocks that have been added via the `PUT /bitcoin/blocks` endpoint.
- Process new blocks to find nBTC deposits.
- Update the confirmation count for existing deposits.
- Finalize transactions that have reached the required confirmation depth.
- Initiate the minting process for finalized transactions.
- Retry failed minting attempts.

## 6. Reorg Handling

The `btcindexer` worker handles Bitcoin reorgs to ensure that only transactions on the canonical chain are processed. The worker relies on a combination of an external relayer and a Sui light client for verification.

1.  Relayer: Its the source of truth for the full blocks, its the same service responsible for keeping the on-chain light client up to date, The data it sends to the worker is the same.

2.  Sui Light Client: The ultimate source of truth for the canonical chain is a. The worker communicates with this light client to verify the validity of block headers before finalizing any transactions. This has been introduced as a safety measure in case the relayer is compromised, or there is a `better` relayer running, updating only the light client.

### Detection

The worker employs two primary mechanisms to detect reorgs:

1.  SPV Light Client:Before attempting to finalize any transactions, the worker performs an SPV check by calling the `verify_blocks` endpoint on the Sui light client. It sends the block hashes of all transactions currently in the `confirming` state. If the light client reports that any of these block hashes are not part of the canonical chain, the worker updates the status of all transactions within those blocks to `reorg`.

2.  Internal Consistency Check: The worker continuously checks for internal consistency. When processing pending transactions, it compares the block hash stored with the transaction against the block hash stored for that same block height in its own database. If the hashes do not match, it indicates that the relayer has provided a new block for that height, and a reorg has occurred. The affected transaction is then marked with the `reorg` status.

## 7. Workflow

### 1. Block Ingestion Flow (push)

This is triggered every time the Relayer sends new block data to the indexer

1.  **Block Submission:** The Relayer sends a batch of new blocks (`height` and `rawBlockHex`).
2.  **Reorg Handling:** If the Relayer sends a block for a `height` that already exists in the `processed_blocks` table, the indexer overwrites it with the new one. This means a reorg happened on Bitcoin.
3.  **Storage:** The indexer saves the full raw block data to the KV store and adds (or updates) the light block info (`height`, `hash`) in the `processed_blocks` table in D1. This table acts as a "to-do" for the cron job.

### 2. Processing Flow (Cron Job)

A cron job runs on a fixed schedule (e.g., every 1 minute)

1.  **Deposit Discovery:** The cron job reads a batch of unprocessed blocks from the `processed_blocks` queue. It fetches the full block data from KV and scans every transaction. If it finds a valid nBTC deposit, it saves the details to the `nbtc_txs` table with a status of `'confirming'`.
2.  **Confirmation & Reorg Processing:** The cron job then queries for all transactions in the `confirming` state.
    - **Confirmation Update:** It calculates the number of confirmations for each transaction based on the latest known block height. If a transaction has enough confirmations its status is updated to `finalized`.
    - **Reorg Detection:** It checks if the `block_hash` for a transaction's block height still exists in the `processed_blocks` table. If it doesn't (because it was overwritten during ingestion), the transaction has been reorged. Its status is changed to `reorg`. This transaction is now considered invalid, but we keep the record for indexing purposes.

### 3. nBTC Tx (Push)

To quickly handle UI nBTC transaction observability, BYield UI will push nBTC transaction, in order to let the indexer start monitoring it. This way UI will have the quick status about the TX, before the tx is added to the blockchain.
