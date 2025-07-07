<!-- markdownlint-disable MD013 -->

# Workers

Backend workers and indexers for BYield services

- [btcindexer](./packages/btcindexer/) - Bitcoin indexer for nBTC and SPV prover.

## Development

### Dependencies

- node >= v22
- pnpm >= 10.12
- proper editorconfig mode setup in your editor!

### Quick Start

Firstly install the latest dependencies and link hooks

```sh
make setup-hooks
pnpm install
```

Run the wrangler dev server of all workers (with auto reload):

```sh
pnpm run dev
```

Watch for changes and automatically test:

```sh
pnpm run test
# To test only some packages
pnpm --filter pattern test
```

To apply migrations to the local Cloudflare env:

```sh
pnpm run db:migrate:local
```

### Using pnpm workspace

- [linking dependencies](https://pnpm.io/workspaces#publishing-workspace-packages)

### Typegen

Generate types for your Cloudflare bindings in `wrangler.toml`:

```sh
pnpm run typegen
```

You will need to rerun typegen whenever you make changes to `wrangler.toml`.

## Contributing

Participating in open source is often a highly collaborative experience. We’re encouraged to create in public view, and we’re incentivized to welcome contributions of all kinds from people around the world.

Check out [contributing repo](https://github.com/gonative-cc/contributig) for our guidelines & policies for how to contribute. Note: we require DCO! Thank you to all those who have contributed!

After cloning the repository, **make sure to run `make setup-hooks`**.
