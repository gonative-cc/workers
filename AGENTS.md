# Cloudflare Workers Project: Native Workers

## Project Overview

This is a Cloudflare Workers project that implements various services for [Go Native](https://github.com/gonative-cc).
It uses [Bun](https://bun.com/) for JavaScript and Typescript runtime and package management (instead of Nodejs + npm).

The content is organized into a Bun workspace in the root @package.json .
Workspaces make it easy to develop complex software as a monorepo consisting of several independent packages.
In the root @package.json , the "workspaces" key is used to indicate which subdirectories should be considered packages/workspaces within the monorepo.
By convention, all packages in the workspace all in the `packages` directory.

Check @README.md for more details.

### Packages

- `./packages/btcindexer` : a Bitcoin indexer (btcindexer) for the nBTC project. The project is designed to monitor the Bitcoin blockchain, parse Bitcoin blocks, identify nBTC deposits, and facilitate their minting on the Sui blockchain.
- `./packages/block-ingestor` : a new worker that exposes REST API to receive new blocks and queue them for processing.
- `./packages/lib` : a library package where we put common functions to be shared with other packages.
- `./packages/redeem_solver` : a new worker to propose UTXOs for withdrawals.

Details about each package is in described in the sections below.

### Core Technologies

- [Bun](https://bun.com/)
- Cloudflare Workers
- TypeScript
- Cloudflare D1 (SQL Database)
- Cloudflare KV (Key-Value Storage)
- Cloudflare Service Bindings
- BitcoinJS Library
- Sui Blockchain integration

Key components:

- **Service Bindings**: Implements proper Cloudflare service-to-service communication using service bindings instead of direct HTTP calls

### Setup

To install all dependencies, run this in the root directory:

```bash
bun install
```

### Build and run

To run all tests:

```bash
bun run test
```

To enable verbose logging, run:

```bash
ENABLE_LOGS=1 bun run test
```

To indicate that the tests are being run by an agent, run:

```bash
AGENT=1 bun run test
```

To run tests of a specific package, firstly enter into the package directory and then:

```bash
# Run tests
bun run test

# Type checking
bun run typecheck
```

To run a worker, firstly enter into the package directory and run:

```bash
bun run dev
```

## BTCIndexer

The package is in `./packages/btcindexer`.

### Architecture

The project consists of:

1. A main worker (`src/index.ts`) that handles HTTP requests, Cloudflare RPC and scheduled cron jobs
2. An indexer module (`src/btcindexer.ts`) that processes Bitcoin blocks and transactions
3. A router module for handling API endpoints
4. Sui client for interacting with the Sui blockchain
5. Separate service for external API calls (Electrs API) using service bindings

### Core Logic

- `packages/btcindexer/src/index.ts` - Main worker entry point
- `packages/btcindexer/src/btcindexer.ts` - Bitcoin indexing logic
- `packages/btcindexer/src/electrs-service.ts` - Service binding implementation for external API calls
- `packages/btcindexer/src/sui_client.ts` - Sui blockchain integration

### Tests

- `packages/btcindexer/src/btcindexer.test.ts` - Comprehensive tests for the indexer
- `packages/btcindexer/src/bitcoin-merkle-tree.test.ts` - Tests for Merkle tree implementation

### Key Features

#### 1. Bitcoin Block Processing

- Cron job runs every minute to scan new Bitcoin blocks
- Identifies nBTC-related deposits using OP_RETURN outputs
- Processes transaction confirmations and finalization

#### 2. Cross-Chain Communication

- Tracks Bitcoin deposits and mints corresponding nBTC on Sui
- Implements Merkle proof validation for cross-chain communication
- Uses Sui light client for block verification

#### 3. Service Bindings Implementation

- Replaced direct fetch calls to external APIs with proper service bindings
- Created a dedicated Electrs API service worker for handling external API requests
- Follows Cloudflare's recommended approach for worker-to-worker communication

#### 4. Data Storage

- Uses D1 database to store transaction details, confirmations, and minting status
- Uses KV namespaces for block storage and nBTC transaction caching
- Implements proper data persistence and querying

## Block Ingestor

The package is in `./packages/block-ingestor`.
See @packages/block-ingestor/README.md for information about key features and architecture.

### Architecture

The project consists of:

1. A main worker (`src/index.ts`) that handles HTTP requests to receive new blocks
2. An API module (`src/api/put-blocks.ts`) that handles msgpack encoding/decoding of block data
3. An ingestion module (`src/ingest.ts`) that processes and queues the received blocks
4. A client module (`src/api/client.ts`) for sending blocks to the worker

## Lib

The package is in `./packages/lib`.

### Architecture

A shared library package containing common utilities and types used across other packages:

1. Logger module (`src/logger.ts`) for structured logging
2. Bitcoin network utilities (`src/nbtc.ts`) with common types and functions
3. Sui network utilities (`src/nsui.ts`) with configuration types

### Core Components

- `packages/lib/src/logger.ts` - Structured logging implementation
- `packages/lib/src/nbtc.ts` - Bitcoin network types and utility functions
- `packages/lib/src/nsui.ts` - Sui network configuration types

### Key Features

#### 1. Shared Types

- BtcNet and SuiNet enums for network identification
- Common interfaces for cross-package communication
- Block queue record definitions

#### 2. Utilities

- Structured logging with JSON output
- Utility functions for key generation and management
- Delay function for async operations

## Redeem Solver

The package is in `./packages/redeem_solver`. See @packages/redeem_solver/README.md for information about key features and architecture.

### Architecture

The project consists of:

1. A main worker (`src/index.ts`) that serves as the entry point
2. An RPC module (`src/rpc.ts`) that exposes service binding interface
3. A Sui client (`src/sui_client.ts`) for blockchain interactions
4. A storage module (`src/storage.ts`) for data persistence
5. Model definitions (`src/models.ts`) for data structures

#### 2. Service Bindings Implementation

- Exposes Cloudflare RPC interface for inter-worker communication
- Follows Cloudflare's recommended approach for worker-to-worker communication
- Designed to integrate with the broader nBTC ecosystem

## Development Conventions

### Code Style

- Uses TypeScript with strict type checking. When finalizing agent work run `bun run typecheck` to typecheck the code.
- Follows ESLint and Prettier for consistent code (and Markdown) formatting. When finalizing agent work run `bun run format` to format the code.
- Includes comprehensive type definitions

### Testing

- **Test Framework**: Bun's built-in test framework with Miniflare for mocking Workers and CF Env.
- Tests cover critical functionality including:
  - nBTC deposit detection
  - Merkle tree proof generation
  - Transaction finalization logic
  - Cross-chain minting flow
  - Mock environments for testing without external dependencies
- **Integration Tests**: Full flow with mocked Sui and electrs
- **Unit Tests**: Merkle tree, storage, API components
- **Test Data**: Real Bitcoin regtest blocks (fetched from https://learnmeabitcoin.com/explorer/) in `btcindexer.test.ts`

### Configuration

- Uses wrangler.jsonc for Cloudflare Workers configuration
- Separate configuration files for development and production
- Environment variables for network settings, API URLs, and blockchain IDs

### Service Bindings

- Proper implementation of service bindings following Cloudflare documentation
- Secure communication between worker components

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
│   └── btcindexer/
│       ├── db/
│       │   └── migrations/
│       └── src/
│           ├── api/
│           ├── btcindexer.test.ts
│           ├── electrs-service.ts
│           ├── models.ts
│           ├── router.ts
│           ├── sui_client.ts
│           └── sui_client.test.ts
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
├── wrangler.jsonc  # Configuration for development environment
└── wrangler-prod.jsonc  # Configuration for production environment
```
