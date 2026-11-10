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

### Pre-commit check

- Installed once per machine: `git config core.hooksPath .githooks`. The hook materialises **the tree this
  commit will actually contain** (`git checkout-index -a --prefix=<tmp>/`, which reads the temporary index git
  prepares for `git commit -- <paths>`) and typechecks *that*, plus the four component guards. Typechecking the
  worktree was not enough: `git commit -- <path>` commits a tree that differs from the working directory.
  Measured cost: **~11 s for a scripts-only commit**. The 2026-11-10 incident replay — one product file plus
  its seven callers — costs **30.7 s red / 27.7 s green**, and that is the product file itself: the same
  program without the callers already takes 25.4 s, versus 22.9 s with them. It never runs `verify` or the
  test suite, and it gives up rather than block when the budget runs out.
- **Callers are in scope (reverse dependencies).** Listing only the commit's own files made `tsc` follow
  imports *forward*, so a caller was never in the program: a required prop was added to a component,
  one host was updated, another was not, and the error reached the branch with the hook green. The hook now
  finds, for each committed code file, the files that import it (`scripts/pre-commit-callers.mts`): one layer
  only, up to a cap (over the cap it reports how many callers were left out), and `index.ts(x)` is excluded
  because a `./dir` import cannot be reversed from a file name. An error landing on one of those callers
  **blocks**, and the message labels it as a caller that did not follow.

  - **A path mentioned in a comment is not a caller.** Only `import` / `export … from` / `require(…)` /
    dynamic `import(…)` lines count: a comment naming a script used to pull that script's whole import graph
    into the program and took one scripts-only commit from 12.4 s to 28 s.

- **Unstaged changes on the files being committed are reported, not blocked.** `git commit -- <path>` commits
  the *worktree* content of that path, not the index, so an in-flight hunk from another line inside the same
  file ships with it. The hook compares `git diff --name-only` against the commit set and names the files
  (`scripts/pre-commit-unstaged.mts`). Warning only, exit code stays 0: `git add -p` is a legitimate way to
  stage part of a file, and a check that stops normal commits gets switched off — worse than the risk it covers.
- Skip one commit with `SKIP_PRE_COMMIT=1 git commit …` (emergency only), then run `pnpm typecheck` yourself.
- It covers only what a scoped test run cannot see. It is not a substitute for `pnpm typecheck`, and never for
  the runner's full gate.
- **A commit that changes an import or an export must carry both sides.** `git commit -- <path>` will happily
  commit half a chain; the hook now blocks that shape, but the rule is to never create it in the first place.

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
