[English](./packaging.md) | [中文](./packaging.zh-CN.md)

# Packaging and release

This page describes how to produce a distributable desktop build from this checkout.

## Current support

- **macOS (arm64)**: `pnpm dist:mac` produces an unsigned `.dmg`. Verified from mount to a running
  dashboard.
- **Windows (x64)**: `pnpm dist:win` produces an NSIS installer. Built and tested by the
  `package-windows` CI job; it has not been verified on Windows hardware yet.
- **Linux**: no packager configuration.

## Build the application bundles

```bash
pnpm build
```

The build writes the unpackaged application:

```text
out/main/       Electron main process
out/preload/    preload bridge
out/renderer/   React renderer
```

This is the input to the packager. It is not a distributable artifact.

## Build the macOS package

Prerequisites: a macOS host, Node.js 22, pnpm 10, and the Xcode command line tools (`hdiutil`).

```bash
pnpm install
pnpm dist:mac        # build bundles, then release/MacroBay-<version>-arm64.dmg
pnpm dist:mac:dir    # build bundles, then release/mac-arm64/MacroBay.app only
```

`dist:mac` runs `pnpm build` first, so the generated product registry and Vite bundles are always
current. The output directory is `release/`, which is ignored by git.

### What the package contains

- the `out/` bundles and `package.json`;
- production dependencies of the root `package.json` (no dev dependencies, no tests, no docs);
- `resources/skills` copied to `Contents/Resources/skills` through `extraResources`, which is where
  the main process reads built-in skills from a packaged app;
- `resources/icon.icns` as the bundle icon;
- the agent runtime: `@anthropic-ai/claude-agent-sdk` plus its platform-native CLI
  (`@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`, about 237 MB).

### Why the application directory is not archived (`asar: false`)

The agent runtime spawns that native CLI as a separate process, and the SDK resolves the binary from
its own package directory. Node cannot execute a file that only exists inside an asar archive, so the
first build ships an unpacked application directory. Turning asar on requires an `asarUnpack` entry
for the SDK packages plus an explicit `pathToClaudeCodeExecutable` that points at
`app.asar.unpacked`. That is a separate change, not a switch to flip.

### Signing and notarization

`mac.identity: null` in `electron-builder.yml` keeps local builds unsigned. An unsigned build that is
downloaded from the internet is blocked by Gatekeeper until the user right-clicks → **Open**, or runs:

```bash
xattr -dr com.apple.quarantine /Applications/MacroBay.app
```

To sign, set `CSC_LINK`/`CSC_KEY_PASSWORD` (or install the identity in the keychain), replace
`identity: null` with that identity, and enable `hardenedRuntime`. Notarization additionally needs
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. Neither is part of this release.

### Other architectures

The configured target is arm64 because that is the verified machine. Building x64 or universal also
requires the matching platform package for the agent CLI, which pnpm does not install for a different
platform automatically. Install that optional package first, confirm
`node_modules/@anthropic-ai/claude-agent-sdk-darwin-x64/claude` exists, then run
`pnpm exec electron-builder --mac --x64`.

### Download mirrors (optional)

If Electron or packager tool downloads time out, point them at a mirror for one command:

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
pnpm dist:mac
```

## Verify a build

1. `pnpm dist:mac:dir`, then `open release/mac-arm64/MacroBay.app`.
2. The main window is titled `MacroBay 观潮` and renders the intelligence dashboard; local data is
   written under `~/Library/Application Support/MacroBay`.
3. `hdiutil verify release/MacroBay-<version>-arm64.dmg`, mount it, drag the app to Applications, and
   launch it from there.
4. Reference sizes for `0.1.0` on arm64: about 184 MB for the `.dmg`, about 550 MB for the installed
   bundle.

## Build the Windows package

```bash
pnpm dist:win        # build bundles, then release/MacroBay-<version>-x64-setup.exe
pnpm dist:win:dir    # build bundles, then release/win-unpacked/ only
```

Run this on Windows, or let the `package-windows` CI job do it. Building on macOS also works through
Wine, but pnpm only installs the win32 agent CLI on Windows, so a cross-built installer ships without
that binary and the agent cannot start there. That is why the Windows artifact is produced on
`windows-latest`.

The installer is per-user by default, lets the user pick the install directory, and creates desktop
and Start menu shortcuts. Signing needs an Authenticode certificate through `CSC_LINK` and
`CSC_KEY_PASSWORD`; an unsigned installer triggers SmartScreen until the user chooses to keep it.

The Windows build has not been exercised on Windows hardware yet. Verify first: window and dashboard,
model-service settings, one real agent turn, taskbar icon and grouping, and notifications.

## Linux

Not configured. It needs its own pass over the same list: icon assets, a Linux target, and a CI job
that builds on that OS.

## Windows-only follow-ups

- `openWithSystemApp` still shells out to the macOS `open -a`; the "open with" targets are macOS
  names. On Windows those entries cannot work yet.
- The tray icon is created empty, which is invisible on Windows. The app quits when the last window
  closes there, so this is not blocking, but it is not a usable tray either.

## Versioning

`package.json` currently uses `0.1.0`. The first public release should define:

- a versioning policy for the app and product manifests;
- a changelog;
- an upgrade note for local `userData` and database migrations;
- a support matrix for macOS, Windows, and Linux.

## Verification before a release

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm docs:check
```

Then install the produced package on a clean machine and verify:

- first launch and model-service configuration;
- a real agent turn;
- local data written under `userData`;
- no credentials or local paths in logs;
- uninstall and data removal behavior.

## Next

- [Status and limitations](../reference/status-and-limitations.md)
- [Testing](./testing.md)
