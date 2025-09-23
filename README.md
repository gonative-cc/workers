<!-- markdownlint-disable MD013 -->

# Workers

Backend workers and indexers for BYield services

- [btcindexer](./packages/btcindexer/) - Bitcoin indexer for nBTC and SPV prover.

## Build Info

### Dependencies

- bun >= 1.20.0
- proper editorconfig mode setup in your editor!
- Go (for Go API Client for the workers)

### Bun workspace

This is a monorepo: workspace with several sub packages.
Check [linking dependencies](https://bun.sh/docs/install/workspaces) to learn how to manage dependencies between sub-packages.

### Quick Start

Firstly install the latest dependencies and link hooks

```sh
make setup-hooks
bun install
```

Run the wrangler dev server of all workers (with auto reload):

```sh
bun run dev
```

Watch for changes and automatically test:

```sh
bun run test
# To test only some packages
bun run --filter pattern test
```

To apply migrations to the local Cloudflare env:

```sh
bun run db:migrate:local
```

### Local development of a worker

```sh
cd packages/<worker_name>
# this will start local server with local bindings to storage
# it will print the localhost port binding
bun wrangler dev

# now we can interact with the server, for example
curl http://localhost:8787/test-kv -X PUT -d '{"key": "k1", "val": "v1"}'
```

### Typegen

Generate types for your Cloudflare bindings in `wrangler.toml`:

```sh
bun run cf-typegen
```

You will need to rerun cf-typegen whenever you make changes to `wrangler.toml`.

## Contributing

Participating in open source is often a highly collaborative experience. We're encouraged to create in public view, and we're incentivized to welcome contributions of all kinds from people around the world.

Check out [contributing repo](https://github.com/gonative-cc/contributig) for our guidelines & policies for how to contribute. Note: we require DCO! Thank you to all those who have contributed!

After cloning the repository, **make sure to run `make setup-hooks`**.
