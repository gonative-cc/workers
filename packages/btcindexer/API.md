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
      "entrypoint": "BtcIndexerRpc"
    }
  ]
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
  }
};
```

## Available RPC Methods

### `putBlocks(blocks: PutBlocks[]): Promise<number>`

Stores new Bitcoin blocks in the indexer's kv store.

**Parameters:**
- `blocks`: Array of blocks to store

**Returns:** Number of blocks inserted

### `getLatestHeight(): Promise<{ height: number | null }>`

Get the latest block height stored in the indexer.

**Returns:** Object containing the latest height (or null if no blocks exist)

### `registerBroadcastedNbtcTx(txHex: string): Promise<{ tx_id: string; registered_deposits: number }>`

Register a broadcasted nBTC transaction.

**Parameters:**
- `txHex`: The transaction hex string

**Returns:** Transaction ID and number of registered deposits

### `getStatusByTxid(txid: string): Promise<NbtcTxStatusResp | null>`

Get nBTC transaction status by Bitcoin transaction ID.

**Parameters:**
- `txid`: Bitcoin transaction ID

**Returns:** Transaction status or null if not found

### `getStatusBySuiAddress(suiAddress: string): Promise<NbtcTxStatusResp[]>`

Get all nBTC transactions for a specific Sui address.

**Parameters:**
- `suiAddress`: Sui recipient address

**Returns:** Array of transaction statuses

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
