[English](./testing.md) | [中文](./testing.zh-CN.md)

# Testing

The test suite is the main regression guard for the platform and the bundled product.

## Commands

```bash
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test` runs Vitest from the repository root. It does not require model-provider credentials.

## What the suite covers

- Pure functions and data projections.
- React components rendered in a DOM environment.
- IPC handlers and contract validation.
- Agent and assistant runtime state transitions.
- Product service bootstraps and query behavior.
- Architecture boundary guards for platform/product imports.

The suite is intentionally broad. A narrow unit test is preferred when the behavior can be tested
without rendering or IPC; use the heavier tests for integration seams.

## Channel suites

Channel integrations are not exposed in this release. Their tests are excluded from the default
run so the visible feature set and the green suite agree. If channels are re-enabled, their UI and
tests must be restored together; do not leave a permanently excluded red suite.

## Writing a test

- Test behavior, not implementation details.
- Keep fixtures small and deterministic.
- Never call a real provider from a test.
- Do not assert on private documentation paths.
- For a bug fix, add a regression test that fails before the fix.

## Flaky tests

If a test fails intermittently, first check:

- timers and `Date.now()` assumptions;
- SQLite file cleanup on macOS (`ENOTEMPTY`);
- asynchronous UI updates that need `act` or `waitFor`;
- tests that share a temporary directory or a global mock.

Fix the source of nondeterminism rather than increasing timeouts.

## Documentation checks

Public documentation links should resolve in a fresh checkout. Run a link check before a docs
release, and verify that every English page has a paired `.zh-CN.md`.

## Next

- [Development setup](./setup.md)
- [Status and limitations](../reference/status-and-limitations.md)
