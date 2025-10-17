<!-- markdownlint-disable MD013 -->

# Workers

Backend workers and indexers for BYield services

- [btcindexer](./packages/btcindexer/) - Bitcoin indexer for nBTC and SPV prover.

## Setup

### Dependencies

- bun >= 1.20.0
- proper editorconfig mode setup in your editor!
- Go (for Go API Client for the workers)

### Bun workspace

This is a monorepo: workspace with several sub packages.
Check [linking dependencies](https://bun.sh/docs/install/workspaces) to learn how to manage dependencies between sub-packages.

### Quick setup - dev

Firstly install the latest dependencies and link hooks

```sh
make setup-hooks
bun install
```

Navigate to a package that you want to build or run in the `/packages` directory.
To overwrite env vars used in your wrangler setup, copy: `cp .dev.vars.example .dev.vars` and update the values.

You will also need to setup a secrets store. For each secret defined in the `wrangler.json`:

- check the `store_id` and `secret_name`.
- create a secret with scope `workers`. Example: `bun wrangler secrets-store secret create 75adbc6657de4f4cb739f63eb4d0cd7a --name NBTC_MINTING_SIGNER_MNEMONIC --scopes workers`

Finally, you will need to set up databases used in local wrangler:

```sh
bun run db:migrate:local
```

### Run and test

Run the wrangler dev server of all workers (with auto reload):

```sh
bun run dev
```

Watch for changes and automatically test:

```sh
bun run test
# To test only some packages
bun run --filter package_pattern test
```

To enable logs during testing, use the `ENABLE_LOGS` environment variable:

```sh
ENABLE_LOGS=1 bun run test
```

### Typegen

Whenever you make changes to `wrangler.jsonc` or update `wrangler`, generate types for your Cloudflare bindings:

```sh
bun run cf-typegen
```

## Contributing

Participating in open source is often a highly collaborative experience. We're encouraged to create in public view, and we're incentivized to welcome contributions of all kinds from people around the world.

Check out [contributing repo](https://github.com/gonative-cc/contributig) for our guidelines & policies for how to contribute. Note: we require DCO! Thank you to all those who have contributed!

After cloning the repository, **make sure to run `make setup-hooks`**.
