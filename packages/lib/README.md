# @gonative-cc/lib

Shared library utilities for Go Native workers. This package provides common types, utilities, and helper functions used across all worker packages in the monorepo.

## Overview

The `lib` package contains shared utilities that enable consistent functionality across the btcindexer, block-ingestor, sui-indexer, and compliance workers. It includes network type definitions, logging, authentication, secrets management, and blockchain interaction helpers.

## Core Components

### logger.ts

Structured JSON logging with four log levels:

- `debug` - Detailed debugging information
- `info` - General informational messages
- `warn` - Warning messages
- `error` - Error messages with optional error context

```typescript
import { logger, logError } from "@gonative-cc/lib/logger";

logger.info({ msg: "Operation started", method: "myFunction" });

try {
  // operation
} catch (e) {
  logError({ msg: "Operation failed", method: "myFunction" }, e);
}
```

### nbtc.ts

Bitcoin network types and utilities:

- `BtcNet` enum - Network identification (regtest, testnet, mainnet, signet)
- `BitcoinTxStatus` enum - Transaction lifecycle states (broadcasting, confirming, finalized, reorg)
- `requireElectrsUrl()` - Get Electrs URL for a network
- `btcNetFromString()` - Parse string to BtcNet
- `calculateConfirmations()` - Calculate tx confirmations from block heights

### nsui.ts

Sui blockchain network configuration:

- `SuiNet` type - Network identifiers (testnet, mainnet, devnet, localnet)
- `toSuiNet()` - Validate and convert string to SuiNet
- `SUI_GRAPHQL_URLS` - GraphQL endpoints for each network

### coin-ops.ts

Sui coin management utilities for signing operations:

- `sortCoinsByBalance()` - Sort coins by balance (descending)
- `selectBiggestCoins()` - Select coins to meet a target balance
- `selectCoins()` - Smart coin selection with limit support
- `prepareCoin()` - Prepare coins for transactions with merging

### auth.ts

Request authentication using Bearer tokens with timing-safe comparison:

- `isAuthorized()` - Validate Authorization header against expected secret

### secrets.ts

Secrets management helpers:

- `getSecret()` - Retrieve secrets from Cloudflare secrets store

### rpc-types.ts

Shared RPC type definitions for cross-worker communication:

- Redeem request types and statuses
- Finalize redeem transaction types
- Sui indexer RPC interface
- BTC indexer RPC response types

### setups.ts

Cloudflare environment setup helpers:

- `Setup` interface - Combined BTC/Sui network configuration
- `getSetup()` - Retrieve setup by ID
- `getActiveSetups()` - Get all active setups for an environment
- Predefined environments: TestEnv, dev, staging

## Key Features

### Shared Types

- **BtcNet enum** - Standardized Bitcoin network identification
- **SuiNet type** - Sui blockchain network identifiers
- **BitcoinTxStatus** - Transaction lifecycle states for deposit tracking
- **Setup** - Combined configuration for BTC+Sui network pairs

### Common Interfaces

- **SuiIndexerRpc** - Interface for sui-indexer communication
- **RedeemRequestResp** - Standardized redeem request responses
- **FinalizeRedeemTx** - Cross-worker finalization data

### Structured Logging

JSON-formatted logs with consistent structure:

```typescript
{ "msg": "message", "level": "info", "method": "functionName", ... }
```

### Utility Functions

- Key generation for KV storage (`kvBlocksKey`)
- Network validation and parsing
- Confirmation calculation
- Delay/promise helpers

## Usage

Import shared utilities in other worker packages:

```typescript
import { BtcNet, BitcoinTxStatus } from "@gonative-cc/lib/nbtc";
import { SuiNet, SUI_GRAPHQL_URLS } from "@gonative-cc/lib/nsui";
import { logger, logError } from "@gonative-cc/lib/logger";
import { isAuthorized } from "@gonative-cc/lib/auth";
import { getSetup } from "@gonative-cc/lib/setups";
import { selectCoins, prepareCoin } from "@gonative-cc/lib/coin-ops";
import type { SuiIndexerRpc } from "@gonative-cc/lib/rpc-types";
```

## Testing

Tests are co-located in the same directory as the source files with the `.test.ts` suffix

Run tests:

```bash
bun run test
```

Run type checking:

```bash
bun run typecheck
```
