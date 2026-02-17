# Cloudflare Workers Project: Native Workers

## Project Overview

This is a Cloudflare Workers project that implements various services for [Go Native](https://github.com/gonative-cc).
It uses [Bun](https://bun.com/) for JavaScript and Typescript runtime and package management (instead of Nodejs + npm).

The content is organized into a Bun workspace. See @README.md for:
- High-level architecture and component interactions
- Detailed setup instructions
- Functional flow documentation
- Contributing guidelines

### Packages

All packages are in the `./packages` directory:

| Package | Type | Purpose |
|---------|------|---------|
| `btcindexer` | Service (Worker) | Bitcoin-to-Sui bridging and minting |
| `sui-indexer` | Service (Worker) | Sui blockchain monitoring and redemption |
| `block-ingestor` | Service (Worker) | Receives Bitcoin blocks via REST API |
| `compliance` | Service (Worker) | Sanctions and geo-blocking data |
| `lib` | Shared Library | Common utilities and types |

### Core Technologies

- [Bun](https://bun.com/)
- Cloudflare Workers
- TypeScript
- Cloudflare D1 (SQL Database)
- Cloudflare KV (Key-Value Storage)
- Cloudflare Service Bindings
- Cloudflare Queue
- BitcoinJS Library
- Sui Blockchain integration
- IKA MPC integration

## Build and Run

See @README.md for full setup instructions.

Quick commands:

```bash
# Install dependencies
bun install

# Run all tests
bun run test

# Run with verbose logging
ENABLE_LOGS=1 bun run test

# Run tests for a specific package
cd packages/<package-name> && bun run test

# Type checking
cd packages/<package-name> && bun run typecheck

# Run a worker locally
cd packages/<package-name> && bun run dev
```

## Service Bindings and RPC

Workers communicate via Cloudflare Service Bindings using RPC interfaces. Each service exports:

- `RPC` - Production RPC interface
- `RPCMock` - Mock implementation for testing (where applicable)

### Service Binding Configuration

Service bindings are configured in `wrangler.jsonc` files:

```jsonc
"services": [
  {
    "binding": "SuiIndexer",
    "service": "sui-indexer",
    "entrypoint": "SuiIndexerRpc"
  }
]
```

### RPC Usage Pattern

```typescript
// Access bound service from environment
const result = await env.SuiIndexer.someMethod(params);
```

See @README.md for Cloudflare RPC documentation and examples.

## BTCIndexer

**Location**: `./packages/btcindexer`

### Architecture

- `src/index.ts` - Main entry with HTTP handlers and scheduled cron
- `src/btcindexer.ts` - Bitcoin indexing and deposit detection logic
- `src/router.ts` - HTTP API endpoints
- `src/sui_client.ts` - Sui blockchain integration for minting
- `src/cf-storage.ts` - Cloudflare D1/KV storage layer
- `src/bitcoin-merkle-tree.ts` - Merkle proof generation

### Key Features

1. **Bitcoin Block Processing**: Cron job runs every minute to scan blocks, identify nBTC deposits via OP_RETURN outputs
2. **Cross-Chain Minting**: Tracks deposits and mints corresponding nBTC on Sui with Merkle proof validation
3. **Data Storage**: Uses D1 for transaction data, KV for block storage
4. **Queue Consumption**: Consumes blocks from `block-queue` populated by block-ingestor

### Configuration

- **Cron**: Every minute (`* * * * *`)
- **D1 Database**: `btcindexer-dev`
- **KV Namespaces**: `BtcBlocks`, `nbtc_txs`
- **Queue Consumer**: `block-queue`
- **Service Bindings**: `SuiIndexer`, `Compliance`
- **Secrets**: `NBTC_MINTING_SIGNER_MNEMONIC` (via Secrets Store)

### Database Schema

See migration files in `packages/btcindexer/db/migrations/`:

- `btc_blocks` - Block tracking
- `nbtc_minting` - Deposit transactions
- `nbtc_deposit_addresses` - Deposit addresses
- `nbtc_utxos` - UTXO tracking (states: available, locked, spent)
- `nbtc_redeem_requests` - Redemption requests
- `nbtc_redeem_solutions` - Redemption solutions
- `indexer_state` - Cursor state
- `presign_objects` - IKA presign objects

## Sui Indexer

**Location**: `./packages/sui-indexer`

### Architecture

- `src/index.ts` - Entry point with scheduled task
- `src/processor.ts` - Sui event indexing
- `src/redeem-service.ts` - Redemption processing logic
- `src/redeem-sui-client.ts` - Sui client for redemption
- `src/ika_client.ts` - IKA MPC integration
- `src/storage.ts` - D1 storage layer
- `src/sighash.ts` - Bitcoin sighash calculations

### IKA Integration

The Sui Indexer integrates with IKA (MPC service) for threshold signature operations:

- Uses `@ika.xyz/sdk` for MPC communication
- Manages presign objects for Bitcoin transaction signing
- Implements coin selection logic for redemption transactions

### Key Features

1. **Event Monitoring**: Indexes Sui events for nBTC redemption requests
2. **Redemption Processing**: Handles burn-and-redeem flow with IKA MPC
3. **UTXO Management**: Manages UTXO lifecycle (available → locked → spent)

### Configuration

- **Cron**: Every minute (`* * * * *`)
- **D1 Database**: Shared `btcindexer-dev`
- **Service Binding**: `BtcIndexer`
- **Environment Variables**: `UTXO_LOCK_TIME` (1 hour), `REDEEM_DURATION_MS` (5 min)
- **Secrets**: `NBTC_MINTING_SIGNER_MNEMONIC`

## Block Ingestor

**Location**: `./packages/block-ingestor`

See @packages/block-ingestor/README.md for detailed architecture.

### Architecture

- `src/index.ts` - HTTP router and handlers
- `src/ingest.ts` - Block ingestion logic
- `src/api/put-blocks.ts` - msgpack encoding/decoding
- `src/api/client.ts` - Client for sending blocks

### Key Features

Receives Bitcoin blocks via REST API, validates them, and enqueues to `block-queue` for processing by BTCIndexer.

### Configuration

- **KV Namespace**: `BtcBlocks` (shared with btcindexer)
- **Queue Producer**: `block-queue`
- **Service Binding**: `BtcIndexer`

## Compliance

**Location**: `./packages/compliance`

### Architecture

- `src/index.ts` - Scheduled worker entry point
- `src/sanction.ts` - Sanctions list updating logic
- `src/storage.ts` - D1 storage for sanctions
- `src/rpc.ts` - RPC interface for other services to query compliance data

### Key Features

1. **Sanctions List Updates**: Daily cron job fetches and updates sanctions data
2. **Compliance API**: Exposes RPC methods for other services to check addresses
3. **Geo-blocking**: Supports geo-blocking rules

### Configuration

- **Cron**: Daily at 1am (`0 1 * * *`)
- **D1 Database**: `compliance`

### Database Schema

See migration files in `packages/compliance/db/migrations/`.

## Lib

**Location**: `./packages/lib`

### Architecture

Shared library package containing utilities used across all services:

- `src/logger.ts` - Structured JSON logging
- `src/nbtc.ts` - Bitcoin network types (`BtcNet` enum, `BlockQueueRecord`, `BitcoinTxStatus`)
- `src/nsui.ts` - Sui network types (`SuiNet`, `NbtcPkg`)
- `src/setups.ts` - Environment-specific configurations
- `src/coin-ops.ts` - IKA coin selection logic
- `src/auth.ts` - Authorization utilities
- `src/secrets.ts` - Secrets retrieval from Secrets Store
- `src/rpc-types.ts` - Shared RPC type definitions
- `src/test-helpers/` - Test utilities including D1 initialization

### Key Features

1. **Shared Types**: Network enums, block records, transaction status types
2. **Testing Support**: Mock RPC implementations and D1 test helpers
3. **Utilities**: Logging, delays, key generation

## Development Conventions

### Code Style

- TypeScript with strict type checking - run `bun run typecheck`
- ESLint and Prettier - run `bun run format`
- Comprehensive type definitions required

### Testing

- **Framework**: Bun's built-in test framework with Miniflare for mocking Workers
- **Mock RPC**: Each service provides `RPCMock` implementation for isolated testing
- **Test Data**: Real Bitcoin regtest blocks from https://learnmeabitcoin.com/explorer/
- **Test Helpers**: Located in `packages/lib/src/test-helpers/`

### Configuration Pattern

- `wrangler.jsonc` - Development configuration
- `wrangler-prod.jsonc` - Production configuration
- `.dev.vars` - Local environment variables
- Environment-specific setups in `packages/lib/src/setups.ts`

### Secrets Store

Sensitive data (mnemonics, API keys) is stored using Cloudflare Secrets Store:

```bash
# Bind secrets store in wrangler.jsonc
"secrets_store_stubs": [
  {
    "binding": "SECRETS_STORE",
    "store_id": "your-store-id",
    "preview_store_id": "your-preview-store-id"
  }
]
```

Access via `packages/lib/src/secrets.ts`.

### UTXO Lifecycle

UTXOs progress through states managed by the Sui Indexer:

1. **Available** - UTXO is ready for use in redemption
2. **Locked** - UTXO reserved for a pending redemption (time-limited via `UTXO_LOCK_TIME`)
3. **Spent** - UTXO has been used in a redemption transaction

### Git Hooks

Run `make setup-hooks` to install pre-commit hooks for code quality.

## Project Structure

Regenerate using `tree --gitignore`.

```text
├── .git/
├── api/
│   └── btcindexer/
├── contrib/
│   └── git-hooks/
├── node_modules/
├── packages/
│   ├── btcindexer/
│   ├── sui-indexer/
│   ├── block-ingestor/
│   ├── compliance/
│   └── lib/
├── .editorconfig
├── .gitignore
├── .markdownlint.yml
├── .prettierignore
├── .sourcery.yaml
├── bun.lock
├── eslint.config.mjs
├── LICENSE
├── Makefile
├── package.json
├── README.md
├── readme.org
├── tsconfig.json
├── wrangler.jsonc
└── wrangler-prod.jsonc
```
