# Native Bitcoin Indexer

**Note:** For a more detailed and up-to-date explanation of the btcindexer's architecture, state machine, and API, please see the [DOCUMENTATION.md](./DOCUMENTATION.md) file.

## Objectives

- Proving and tracking nBTC deposits.

## Architecture Overview

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