# Install verification (packaged builds)

One question this page answers: **was a packaged build actually installed and used, and how far did it
get?** Wording in the README, [Status and limitations](../reference/status-and-limitations.md) and
[Packaging](./packaging.md) may only claim what this page shows. **No entry here means unverified.**

## What counts as an entry

- **who** (person), **machine** (model, chip, OS version), **build** (version, artifact name, commit),
  **steps** (mount → Applications → first launch → version line → dashboard → one conversation),
  **result**, and where the evidence lives (log line, screenshot, issue link).
- A build that finished `dist:*` is **build-level only**. A row becomes "installed" only when a person
  installed the package and used it.

## Status by platform

| Platform | Build | Evidence | Status |
|---|---|---|---|
| macOS arm64 | 0.4.0 | User, Apple silicon Mac; the 0.4.1 tracking notes record two defect reports with screenshots taken from the **installed 0.4.0 package** | installed and used; not a formal acceptance pass |
| macOS arm64 | 0.4.1 – 0.4.3 | none | no real install since 0.4.1 |
| macOS arm64 | 0.4.4 (in preparation) | the run below (2026-11-19) | build-level passed; real install pending |
| macOS x64 | 0.4.x | CI dry run `42605502965` (2026-11-09): `MacroBay-x64.dmg` 203,351,759 B, `hdiutil verify` VALID, app and bundled CLI both `x86_64` | not installed on Intel hardware (a user has claimed that check) |
| Windows x64 | 0.4.x | builds in CI; the Windows 11 x64 machine built it (per the packaging guide) | install and runtime not accepted; no Windows environment |

## 2026-11-19: build-level check of the arm64 package (0.4.4 preparation)

- Machine: Apple silicon (`uname -m` = `arm64`), macOS 14.4.
- Commit `07f45eb`; at build time the tree also held 10 uncommitted paths belonging to other lines, so
  this build is not a clean-tree artifact.
- `pnpm dist:mac` → exit 0, 6m00s.
- Artifact `release/MacroBay-arm64.dmg`, **268,626,471 bytes**; `hdiutil verify` → `checksum … is VALID`.
- `release/mac-arm64/MacroBay.app/Contents/MacOS/MacroBay` → `Mach-O 64-bit executable **arm64**`;
  `Info.plist` `CFBundleShortVersionString` = `0.4.3` (the version bump happens after this check).
- Bundled agent CLI `…/claude-agent-sdk-darwin-arm64/claude` → **arm64**.
- The same bundle also carries `claude-agent-sdk-darwin-x64/claude` (`x86_64`), because this machine's
  `node_modules` still holds the Intel variant seeded for the 2026-11-09 Intel check. A clean install on
  arm64 does not include it; the arm64 release job installs fresh on an arm64 runner.
- **Not done: nothing was installed, nothing was launched.** Team rule: only a person starts the app.

## Where this artifact must not be used

The `.dmg` produced by this run is **not a release artifact** and must not be uploaded or used as the
basis for a release: its `node_modules` still carried the Intel CLI variant seeded for the 2026-11-09
Intel check, so the bundle contains an `x86_64` `claude` next to the arm64 one. A clean install on an
arm64 machine (which the arm64 release job does) does not include it.

## Gap closed by this change

The arm64 release job used to assert only that its runner is arm64, never that the bundled CLI inside
the `.dmg` is arm64 — only the x64 job had that assertion. `scripts/release/assert-bundled-agent-cli.mjs`
now reads the Mach-O header of **every** `claude-agent-sdk-darwin-…/claude` in the bundle and fails if
any of them is not the target architecture (a universal binary counts for both). Both mac jobs call it,
so the two architectures are checked by one implementation. Measured on the artifact above: with the
leftover x64 CLI present the assertion exits 1 and names the file; with it removed, exit 0.

## Remaining gaps

1. No Apple silicon real install since 0.4.1.
2. Windows install/runtime: no environment, so no acceptance.

## Adding an entry

Write version and artifact, machine, who, each step and its result, and a link to the evidence. Add a
build-level section here when a packaging change needs one; it never turns a platform into "installed".
