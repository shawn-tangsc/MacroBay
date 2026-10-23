[English](./installation.md) | [中文](./installation.zh-CN.md)

# Installation

This guide builds MacroBay from source. There is no packaged installer in the first public release.

## Requirements

- **Node.js 22 or newer**
- **pnpm 10**
- A desktop session capable of running Electron
- A model provider account and API key for the first real conversation

The current release is developed and verified on macOS. Windows and Linux builds have not been
validated end to end yet; treat them as experimental.

## Install dependencies

From the repository root:

```bash
pnpm install
```

Use the pnpm version declared by the repository. A different major version may produce a different
lockfile.

## Generate the product registry

The shell loads products through a generated registry:

```bash
pnpm generate:products
```

`pnpm dev`, `pnpm test`, `pnpm typecheck`, and `pnpm build` run this step automatically, so you
normally do not need to call it by hand. The generated files live under `products/generated/` and
are not committed.

## Run in development

```bash
pnpm dev
```

This starts the Electron main process and the Vite renderer together. If the app reports that
another instance is already running, close the existing MacroBay window first.

### Common startup problems

- **Port already in use** — the dev server picks another local port automatically; the Electron
  window uses the current one. Check the terminal output if the window stays blank.
- **Electron cannot start in a restricted environment** — some sandboxed or remote Linux sessions
  block Chromium's sandbox. Use a normal desktop session for development. Do not disable the
  sandbox for a production build.
- **A blank window after a large change** — stop `pnpm dev`, run `pnpm generate:products`, and start
  again. A stale generated registry is a common cause.

## Build the application bundles

```bash
pnpm build
```

The output is written to `out/`:

```text
out/main/       Electron main process
out/preload/    preload bridge
out/renderer/   React renderer
```

This is an unpackaged build. Creating a distributable `.dmg`, `.exe`, or `.AppImage` requires a
packaging step that is not included in this release. See
[Status and limitations](../reference/status-and-limitations.md).

## Verify the checkout

```bash
pnpm typecheck
pnpm test
pnpm build
```

The test suite runs with Vitest. No model provider credentials are required for the default test
run.

## Next

- [First run](./first-run.md)
- [Model service](./model-service.md)
