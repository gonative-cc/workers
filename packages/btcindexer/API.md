# BTC Indexer API

This package exposes HTTP API and [Cloudflare RPC](../../README.md#cloudflare-rpc).

## Setting up Service Binding

To use the RPC interface from another worker, you need to set up a service binding in your `wrangler.jsonc`:

### Production

```jsonc
{
  "services": [
    {
      "binding": "BTCINDEXER",
      "service": "btcindexer",
      "entrypoint": "BtcIndexerRpc",
    },
  ],
}
```

### Mock (Local Development/Testing)

For local development without external dependencies, use the mock implementation:

```jsonc
{
  "services": [
    {
      "binding": "BTCINDEXER",
      "service": "btcindexer",
      "entrypoint": "BtcIndexerRpcMock",
    },
  ],
}
```

The mock provides:

- In-memory transaction storage (no database required)
- Simulated block confirmations (1 per 2 minutes)
- Automatic transaction lifecycle progression
- No external service dependencies (Sui, Bitcoin, Electrs)

## Available RPC Methods

See [rpc.ts](./src/rpc.ts) and [rpc-interface.ts](./src/rpc-interface.ts) for the complete API contract.

## REST API

**HTTP Interface**: Use for external communication (e.g., from Go router) and debugging.

The HTTP endpoints are still available at:

- `PUT /bitcoin/blocks` - Store blocks
- `GET /bitcoin/latest-height` - Get latest height
- `POST /nbtc` - Register nBTC transaction
- `GET /nbtc/:txid` - Get transaction by ID
- `GET /nbtc?sui_recipient=0x...` - Get transactions by Sui address
