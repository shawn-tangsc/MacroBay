[English](./packaging.md) | [中文](./packaging.zh-CN.md)

# Packaging and release

This page describes how to produce a distributable desktop build from this checkout.

## Current support

- **macOS (arm64)**: `pnpm dist:mac` produces an unsigned `.dmg`. Verified from mount to a running
  dashboard.
- **Windows (x64)**: `pnpm dist:win` produces an NSIS installer. The release workflow builds it on
  `windows-latest`, and the build also runs through on Windows 11 x64 hardware. The *installed* app
  is not accepted yet.
- **Linux**: no packager configuration.

## CI verification and releases

`.github/workflows/ci.yml` runs on every push to `main` and every pull request and only verifies:
`pnpm docs:check`, typecheck, test, `pnpm build`. It does not pack anything, so a routine pull
request never waits for a dmg.

`.github/workflows/release.yml` is the only packaging lane. It runs when a `v*` tag is pushed:

```bash
git switch main
git pull --ff-only
git tag -a v0.1.1 -m "MacroBay 0.1.1"
git push origin v0.1.1
```

That builds `release/MacroBay-arm64.dmg` on `macos-latest` and the NSIS installer on
`windows-latest`, then publishes one GitHub Release with both files, their blockmaps and the
auto-update metadata attached. Neither lane needs signing secrets.

- The tag must be `v` plus the `version` in `package.json`; the job stops before packaging otherwise,
  because electron-builder names artifacts from the manifest, not from the tag.
- Re-running a tag that already has a release replaces its assets and keeps its notes, so a failed
  run is recoverable without moving the tag.
- Nothing is signed; the release notes carry the Gatekeeper and SmartScreen bypass.

To check packaging **before** cutting a tag, run **Actions → Release → Run workflow** with the branch
(or commit) as the ref and `publish` unchecked. Both installers are built and left on the run page as
artifacts, and no release is touched.

The two builds stay on separate runners because the agent runtime's native CLI is an optional
dependency that pnpm installs for the host platform only. A single runner would publish one artifact
without a working agent.

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
pnpm dist:mac        # build bundles, then release/MacroBay-arm64.dmg
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
3. `hdiutil verify release/MacroBay-arm64.dmg`, mount it, drag the app to Applications, and
   launch it from there.
4. Reference sizes for `0.1.0` on arm64: about 184 MB for the `.dmg`, about 550 MB for the installed
   bundle.

## Build the Windows package

```bash
pnpm dist:win        # build bundles, then release/MacroBay-x64-setup.exe
pnpm dist:win:dir    # build bundles, then release/win-unpacked/ only
```

Prerequisites: Windows 10/11 x64 host, Node.js 22, pnpm 10. The first build downloads the Windows
Electron distribution and the NSIS packer; later builds hit the local cache.

Run this on Windows, or let the release workflow do it on a tag. Building on macOS also works through
Wine, but pnpm only installs the win32 agent CLI on Windows, so a cross-built installer ships without
that binary and the agent cannot start there. That is why the Windows artifact is produced on
`windows-latest`.

The installer is per-user by default, lets the user pick the install directory, and creates desktop
and Start menu shortcuts. Signing needs an Authenticode certificate through `CSC_LINK` and
`CSC_KEY_PASSWORD`; an unsigned installer triggers SmartScreen until the user chooses to keep it.

### What the installer does

`pnpm dist:win` produces an NSIS **assisted** installer (`oneClick: false`), not a one-click silent
install. Double-clicking walks through install options → install location → progress → finish, where
the options page offers "for anyone who uses this computer" or "only for me" (`perMachine: false`).
The installer creates desktop and Start menu shortcuts and registers an uninstall entry in Apps &
Features.

The wizard header and sidebar come from `resources/installerHeader.bmp` (150×57) and
`resources/installerSidebar.bmp` (164×314), wired through `nsis.installerHeader` /
`nsis.installerSidebar`. Without them the MUI header renders blank and the wizard looks like it has
no guidance at all.

Reference sizes for `0.1.0` on Windows 11 x64: about 164 MB for the installer, about 613 MB for the
unpacked directory, of which the native agent CLI `claude.exe` is about 247 MB (it is not compressed,
see `asar: false` above).

### Verifying a Windows build

1. `pnpm dist:win:dir`, then run `release\win-unpacked\MacroBay.exe`: the window is titled
   `MacroBay 观潮` and renders the dashboard.
2. Local data is written under `%APPDATA%\MacroBay`; closing the last window quits the process.
3. Double-click `release\MacroBay-x64-setup.exe` and confirm all four wizard pages appear,
   the shortcuts work, and Apps & Features lists the uninstall entry.
4. Launch the installed build from the Start menu, check the taskbar icon and grouping plus
   notifications; uninstalling should leave `%APPDATA%\MacroBay` in place.

The build itself now runs through on Windows 11 x64 hardware and produces the installer, but the
**installed** app has not been accepted end to end yet.

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
