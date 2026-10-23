[English](./packaging.md) | [中文](./packaging.zh-CN.md)

# Packaging and release

This page describes the current build output and what is still missing for a distributable desktop
release.

## Current build

```bash
pnpm build
```

The build writes:

```text
out/main/       Electron main process
out/preload/    preload bridge
out/renderer/   React renderer
```

This is an unpackaged application. It is suitable for local development and verification, not for
handing to an end user.

## What is not included

- `.dmg`, `.exe`, `.AppImage`, or `.deb` packaging;
- application icons for all platforms;
- code signing and notarization;
- auto-update;
- a release publishing workflow.

Do not describe the project as having a downloadable installer until these are implemented and
verified.

## Adding a packager

A future packaging change should:

1. Add a packager such as `electron-builder` or Electron Forge.
2. Declare application id, product name, icons, and target platforms.
3. Keep the Vite output path aligned with the packager's `files` configuration.
4. Exclude local data, tests, docs, and generated caches from the package.
5. Add a CI job that builds the package on each target OS.
6. Document signing identities as CI secrets, never as repository files.

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
