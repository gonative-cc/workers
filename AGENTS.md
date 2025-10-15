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

## Development Conventions

### Code Style

- Uses TypeScript with strict type checking
- Follows ESLint and Prettier for consistent code formatting
- Includes comprehensive type definitions

### Testing

- Unit tests using Bun's built-in test framework
- Tests cover critical functionality including:
  - nBTC deposit detection
  - Merkle tree proof generation
  - Transaction finalization logic
  - Cross-chain minting flow
- Mock environments for testing without external dependencies

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
