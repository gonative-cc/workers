# BTC Indexer API

This package exposes HTTP API and Cloudflare RPC.

## Cloudflare RPC

Cloudflare RPC is designed and limited to communicate directly between Cloudflare Workers, without going through HTTP endpoints. This enables efficient inter-worker communication using [Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/).

The RPC interface is provided through the `BtcIndexerRpc` class, which extends `WorkerEntrypoint` from Cloudflare Workers.

### Setting up Service Binding

To use the RPC interface from another worker, you need to set up a service binding in your `wrangler.jsonc`:

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

### Calling RPC Methods

From your worker code:

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Access the btcindexer RPC stub
    const btcIndexer = env.BTCINDEXER;

    // Call RPC methods directly
    const latestHeight = await btcIndexer.getLatestHeight();
    console.log(`Latest block height: ${latestHeight.height}`);

    // Query transaction status
    const txStatus = await btcIndexer.getStatusByTxid("some_tx_id");

    // Get transactions for a Sui address
    const transactions = await btcIndexer.getStatusBySuiAddress("0x...");

    return new Response("OK");
  },
};
```

## Available RPC Methods

See [rpc.ts](./src/rpc.ts).

## HTTP vs RPC

Both interfaces remain available:

- **HTTP Interface**: Use for external communication (e.g., from Go router) and debugging
- **RPC Interface**: Use for inter-worker communication within Cloudflare Workers for better performance and type safety

The HTTP endpoints are still available at:

- `PUT /bitcoin/blocks` - Store blocks
- `GET /bitcoin/latest-height` - Get latest height
- `POST /nbtc` - Register nBTC transaction
- `GET /nbtc/:txid` - Get transaction by ID
- `GET /nbtc?sui_recipient=0x...` - Get transactions by Sui address

## Benefits of RPC

1. **Type Safety**: Direct method calls with TypeScript types
2. **Performance**: No HTTP overhead
3. **Simplicity**: No need to serialize/deserialize HTTP requests
4. **Direct Object Passing**: Can pass complex objects directly between workers
