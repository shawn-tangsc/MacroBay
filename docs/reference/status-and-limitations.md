[English](./status-and-limitations.md) | [中文](./status-and-limitations.zh-CN.md)

# Status and limitations

MacroBay is at `0.4.2`. This page describes what is usable today and what is intentionally not
supported yet.

## Usable from source

- The desktop shell starts with `pnpm dev`.
- Model providers can be added, enabled, and given an API key.
- A default model can be selected for agents and assistants.
- Agent sessions can run with the bundled `market-intelligence` product.
- The dashboard, macro calendar, source configuration, and analyst agent are reachable from the
  product.
- The daily briefing reads the collected evidence and can be generated from the briefing page.
- Structured agent questions and tool approvals are rendered in the conversation.
- The repository passes `pnpm verify`.

## Not usable in this release

### Channel integrations

Platform code for Telegram, Slack, Lark, Discord, QQ, and WeChat is present, and the channel settings
page is reachable from the desktop shell: channels can be created, and credentials can be stored for
the adapters that have a runtime implementation. No adapter is enabled in this release, and the app
offers no way to enable one, so a channel created here sends and receives nothing. Treat channels as
unavailable until an adapter is deliberately enabled.

### Official BLS calendar

The official BLS release calendar cannot be fetched from this network: `www.bls.gov` and
`api.bls.gov` return 403 at the CDN edge, with or without the proxy. Automatic BLS schedule and value
sync is therefore disabled. Stored BLS events come from the last successful sync and carry no release
time. The Fed and BEA calendars and the market-sourced calendar are unaffected.

### Packaged installers

`pnpm build` produces Electron bundles under `out/`. A macOS `.dmg` can be built from source with
`pnpm dist:mac`; it is unsigned and not notarized, so a downloaded copy takes two steps: **right-click
the app → Open** (a double-click is refused), or run
`xattr -dr com.apple.quarantine /Applications/MacroBay.app`. The Windows installer is unsigned too:
SmartScreen shows *Windows protected your PC* and the user picks **More info → Run anyway**. Both
prompts return after **every downloaded update**, not just the first install. Windows packaging is
configured and its installer builds both in CI and on Windows 11 x64 hardware, but the installed app is
not accepted yet; Linux packaging is not configured. There is no auto-update channel. See
[Packaging](../development/packaging.md).

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

## Network and proxy limits

- Proxy mode defaults to following the system proxy. If the system still keeps an old proxy that no
  longer connects, a new install's outbound requests go through it first and then fail. That case is
  meant to be visible in the proxy self-check: it is there to name the unreachable system proxy, so a
  blocked connection is not read as the model service being down.

## Product limits

- Market intelligence is decision support, not investment advice.
- There is no order execution, portfolio management, or brokerage connection.
- Analysis quality depends on the sources, credentials, and data the user configures.
- A missing source produces an explicit gap; it is not silently replaced.
- The agent selection page has no entry point right now: **Intelligence** lands directly on the
  dashboard.

## API and configuration stability

The `0.4.2` release does not promise stable internal APIs, database schemas, or settings shapes.
Back up `userData` before upgrading. Product manifests and platform contracts may change between
minor releases while the public surface is being stabilized.

## Reporting a problem

When reporting a bug, include:

- operating system and version;
- whether the app was started from source or a package;
- the exact error text from the UI;
- relevant local logs with credentials and personal paths removed.
