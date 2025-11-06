# API

This package exposes [Cloudflare RPC](../../README.md#cloudflare-rpc).

### Setting up Service Binding

To use the RPC interface from another worker, you need to set up a service binding in your `wrangler.jsonc`:

```jsonc
{
  "services": [
    {
      "binding": "RdeemSolver",
      "service": "redeem_solver",
      "entrypoint": "RPC",
    },
  ],
}
```

### Calling RPC Methods

See btcindexer [API](../btcindexer/API.md) for an example.

## Available RPC Methods

See [rpc.ts](./src/rpc.ts).
