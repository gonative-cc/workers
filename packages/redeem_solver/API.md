# API

This package exposes [Cloudflare RPC](../../README.md#cloudflare-rpc).

## Setting up Service Binding

To use the RPC interface from another worker, you need to set up a service binding in your `wrangler.jsonc`:

```jsonc
{
  "services": [
    {
      "binding": "RedeemSolver",
      "service": "redeem_solver",
      "entrypoint": "RPC",
    },
  ],
}
```

## Available RPC Methods

See [rpc.ts](./src/rpc.ts).
