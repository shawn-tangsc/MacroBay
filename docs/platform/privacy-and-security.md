[English](./privacy-and-security.md) | [中文](./privacy-and-security.zh-CN.md)

# Privacy and security

MacroBay is local-first. It does not have a MacroBay account, a hosted workspace, or a product
analytics pipeline.

## Where data lives

Application state is stored under the Electron `userData` directory:

```text
macOS:     ~/Library/Application Support/MacroBay
Windows:   %APPDATA%/MacroBay
Linux:     ~/.config/MacroBay
```

This includes settings, provider configuration, conversations, local databases, logs, and
product-owned records. The directory is not encrypted as a whole; protect the OS account and the
disk.

## Credentials

Provider API keys are stored through the platform secret store, backed by Electron `safeStorage`.
The renderer receives:

- `hasApiKey` — whether a key exists;
- a masked preview — never the full value by default.

A user can explicitly reveal a stored key in the settings UI for a short window. The app does not
log keys or copy them to the clipboard as part of that flow.

## Network

- Main-process and product-service HTTP traffic goes through the platform proxy-aware adapter.
- WebSocket traffic uses the platform WebSocket adapter.
- The renderer does not call external services directly.
- The configured system or custom proxy applies to model-provider and data-source requests.

## Telemetry

There is no product analytics service. Agent-runtime tracing is local and opt-in; it is not sent to
a MacroBay server.

## Backups

Back up the `userData` directory to preserve settings, conversations, and local records. A backup
contains credentials protected by the OS keychain, so treat it as sensitive.

## Screenshots and logs

Before sharing a screenshot or log, remove:

- API keys and masked previews that could identify an account;
- local absolute paths;
- personal workspace or session names;
- real market positions or account data.

## What the app does not protect against

- A compromised OS account.
- Malware with access to the user's files.
- A provider or data source that receives requests you configured.
- Data you export or copy out of the app.

## Next

- [Status and limitations](../reference/status-and-limitations.md)
- [Architecture](./architecture.md)
