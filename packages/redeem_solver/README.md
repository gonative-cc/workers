# Redeem Solver

## Objectives

- Observing nBTC Redeem transactions.
- Tracking nBTC UTXOs (NOTE: we can use electrs for that).
- Propose spend UTXOs for redeem transactions.

## Architecture Overview

```mermaid
flowchart
    nBTCCtr[nBTC Contract]
    RS[[RedeemSolver]]
    User -- 1 send nBTC request to request redemption --> nBTCCtr
    nBTCCtr -- 2 creates --> ReedemRequest
    RS -- 3 listen --> ReedemRequest
    RS -- 4 propose UTXO set --> ReedemRequest
```

TODO: link full redeem documentation.

## API

See [API.md](./API.md)

## Components

- **Main Worker (`src/index.ts`):** The entry point for all incoming requests.
- **RPC (`src/rpc.ts`):** The RPC server.
- **Sui Client (`src/sui_client.ts`):** Interacts with the Sui blockchain.
- **Storage (`src/storage.ts`):** Manages data persistence using Cloudflare D1 (SQL).
