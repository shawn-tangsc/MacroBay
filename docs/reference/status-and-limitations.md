[English](./status-and-limitations.md) | [中文](./status-and-limitations.zh-CN.md)

# Status and limitations

MacroBay is at `0.1.0`. This page describes what is usable today and what is intentionally outside
the first public release.

## Usable from source

- The desktop shell starts with `pnpm dev`.
- Model providers can be added, enabled, and given an API key.
- A default model can be selected for agents and assistants.
- Agent sessions can run with the bundled `market-intelligence` product.
- The intelligence portal, dashboard, macro calendar, source configuration, and analyst agent are
  reachable from the product.
- Structured agent questions and tool approvals are rendered in the conversation.
- The repository passes `pnpm typecheck`, `pnpm test`, and `pnpm build`.

## Not exposed in this release

### Channel integrations

Platform code for Telegram, Slack, Lark, Discord, QQ, and WeChat is present, but the settings page
and agent runtime panels are hidden. The channel test suites are excluded from the default test
run. Treat channels as unavailable until they are deliberately re-enabled with their UI and tests.

### Packaged installers

`pnpm build` produces Electron bundles under `out/`. A macOS `.dmg` can be built from source with
`pnpm dist:mac`; it is unsigned and not notarized, so Gatekeeper blocks a downloaded copy until the
user allows it. Windows packaging is configured and its installer builds both in CI and on Windows 11
x64 hardware, but the installed app is not accepted yet; Linux packaging is not configured. There is
no auto-update channel. See [Packaging](../development/packaging.md).

### Demo data

No demo database or sample market data is bundled. The dashboard needs real provider credentials
and real source data to show live panels. Screenshots are captured from a sanitized local profile, not a
data feed.

## Platform support

- **macOS**: developed and verified.
- **Windows / Linux**: the Electron code is expected to run, but end-to-end behavior has not been
  validated. Treat these platforms as experimental and report concrete failures.

## Model compatibility

The agent runtime expects a Claude Code-compatible model route. The model service can expose
different protocols; not every model that works for ordinary chat is selectable for an agent.
When a model is unavailable, the agent page explains whether the provider is disabled, the API key
is missing, the model is not enabled, or the runtime is incompatible.

Rate limiting, timeouts, and transient network failures are not the same as an incompatible
endpoint. The app keeps the model selectable and marks the compatibility as unverified rather than
hiding it.

## Data and privacy limits

- Data is local, but it is not encrypted at rest as a whole. Protect the OS account and the
  `userData` directory.
- Provider credentials are stored through the platform secret store; the renderer only receives
  masked previews.
- Backups and migration are the user's responsibility. See
  [Privacy and security](../platform/privacy-and-security.md).
- The MIT license covers the code, not third-party data. See
  [Data and third-party services](./data-disclaimer.md).
- The product is not a hosted service and has no account recovery.

## Product limits

- Market intelligence is decision support, not investment advice.
- There is no order execution, portfolio management, or brokerage connection.
- Analysis quality depends on the sources, credentials, and data the user configures.
- A missing source produces an explicit gap; it is not silently replaced.

## API and configuration stability

The `0.1.0` release does not promise stable internal APIs, database schemas, or settings shapes.
Back up `userData` before upgrading. Product manifests and platform contracts may change between
minor releases while the public surface is being stabilized.

## Reporting a problem

When reporting a bug, include:

- operating system and version;
- whether the app was started from source or a package;
- the exact error text from the UI;
- relevant local logs with credentials and personal paths removed.
