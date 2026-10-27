# Contributing

Thanks for taking a look at MacroBay. This project is a local-first desktop app built as a reusable
platform plus removable product modules.

## Before you start

- Node.js 22+
- pnpm 10
- A desktop session capable of running Electron

```bash
pnpm install
pnpm dev
```

`pnpm dev` keeps its Electron userData in the repository's ignored `.devdata/` directory, so local
databases/settings never write into `%APPDATA%`. On Windows it also runs Electron with `--no-sandbox`
by default because some administrator/restricted sessions cannot start Chromium's sandbox. Override
with `MACROBAY_USER_DATA=<path>` or `NO_SANDBOX=0` if needed; neither default affects packaged builds.

Read the [public documentation](./docs/README.md) first. The most useful pages for contributors are:

- [Development setup](./docs/development/setup.md)
- [Testing](./docs/development/testing.md)
- [Git workflow](./docs/development/git-workflow.md)
- [Architecture](./docs/platform/architecture.md)
- [Platform and products](./docs/platform/platform-and-products.md)

## Architecture boundaries

- `platform` must not import `products`.
- `products` may import `platform`.
- `apps/desktop-shell` loads products through the generated registry.
- Product-specific prompts, data sources, pages, and workflows stay in the product.
- Do not commit `products/generated/*`, local databases, logs, or credentials.

## Making a change

All changes go through a short-lived branch and a pull request; do not push directly to `main`.

```bash
git switch main
git pull --ff-only
git switch -c feat/short-description
```

1. Keep a pull request reviewable: related work may be bundled, unrelated areas should not be.
2. Add or update tests for behavior changes.
3. Run the verification commands before opening the PR.
4. Update the public documentation when a user-facing behavior changes.
5. Do not add captured market data, provider responses, or credentials to the repository.

Use **Squash and merge**, delete the branch after merge, and follow the
[Git workflow](./docs/development/git-workflow.md) for branch names, tags, and releases.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm docs:check
```

`pnpm build` writes the Electron bundles to `out/`.

## Tests and fixtures

- Test behavior, not implementation details.
- Never call a real model provider or market-data source from a test.
- Fixtures must be synthetic or clearly public-domain factual data.
- Do not add a fixture that copies a provider response, article, or paid calendar dataset.
- See the [data disclaimer](./docs/reference/data-disclaimer.md) for the project policy.

## Pull requests

Use the repository PR template. It asks for:

- what changed and why;
- the user-visible effect;
- how it was verified;
- any source or model-provider behavior that changed.

Do not include API keys, local `userData`, screenshots with credentials, or personal paths.

## Reporting bugs

Open a GitHub issue with:

- operating system and app version;
- whether you ran from source or a package;
- the exact UI error;
- relevant logs with secrets and personal paths removed.

For security issues, follow [SECURITY.md](./SECURITY.md) instead of opening a public issue.
