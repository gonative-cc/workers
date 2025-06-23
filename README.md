# Workers

Backend workers and indexers for BYield services

## Development

### Dependencies

- node >= v22
- pnpm >= 10.12
- proper editorconfig mode setup in your editor!

### Quick Start

Firstly install the latest dependencies

```sh
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
