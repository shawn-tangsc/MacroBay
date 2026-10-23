[English](./setup.md) | [中文](./setup.zh-CN.md)

# Development setup

This page is for contributors working on MacroBay itself.

## Requirements

- Node.js 22+
- pnpm 10
- A desktop session for Electron

## Install and run

```bash
pnpm install
pnpm dev
```

`pnpm dev` regenerates the product registry and starts Electron with the Vite renderer.

## Repository layout

```text
apps/desktop-shell/   Electron host and React shell
platform/             generic AI runtime and desktop capabilities
products/             removable product modules
products/generated/   generated product registry (ignored)
scripts/              build and repository tooling
docs/                 public documentation
```

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run the desktop app in development |
| `pnpm build` | Build main, preload, and renderer bundles into `out/` |
| `pnpm typecheck` | TypeScript project check |
| `pnpm test` | Vitest suite |
| `pnpm generate:products` | Regenerate the product registry |
| `pnpm lint` | Currently an alias for `pnpm typecheck` |

## Boundaries

- `platform` must not import `products`.
- `products` may import `platform`.
- `apps/desktop-shell` loads products through the generated registry.
- Product-specific prompts, sources, and pages stay in the product.
- Do not commit `products/generated/*`, local databases, logs, or credentials.

## Where to make a change

| Change | Location |
| --- | --- |
| Model provider behavior | `platform/ai/providers` |
| Agent runtime | `platform/ai/agent-platform` |
| Shell navigation or generic UI | `apps/desktop-shell/src/renderer/src/shell` |
| Market-intelligence behavior | `products/market-intelligence` |
| Public documentation | `docs/` |

## Before opening a pull request

```bash
pnpm typecheck
pnpm test
pnpm build
```

Keep the tree buildable. If a change touches a protected platform seam such as
`platform/desktop/main/app.ts`, `preload/index.ts`, or IPC channels, preserve existing agent,
assistant, and product wiring and add a regression guard.

## Next

- [Testing](./testing.md)
- [Adding a product](./adding-a-product.md)
- [Architecture](../platform/architecture.md)
