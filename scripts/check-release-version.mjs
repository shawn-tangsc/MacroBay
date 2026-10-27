#!/usr/bin/env node
/**
 * Release guard: a release tag must agree with the app version in `package.json`.
 * electron-builder names artifacts from the manifest, so a mismatched tag would
 * publish a `v0.2.0` release containing `MacroBay-0.1.0-arm64.dmg`.
 *
 * Usage: node scripts/check-release-version.mjs v0.1.0
 *        node scripts/check-release-version.mjs          (reads the tag from BUILD_REF)
 *
 * The release workflow calls it without an argument. On `windows-latest` the default shell is
 * PowerShell, where `"$BUILD_REF"` in a `run:` block is an (undefined, therefore empty)
 * PowerShell variable, not the environment variable that `release.yml` exports — the guard then
 * rejects the empty tag and the job stops before packaging. Reading the environment here keeps
 * the step free of shell-specific quoting on every runner.
 */
import { readFileSync } from 'node:fs'

const tag = (process.argv[2] ?? process.env.BUILD_REF ?? '').trim()
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const expected = `v${version}`

if (!tag) {
  console.error(`no release tag given: pass it as an argument or set BUILD_REF (expected "${expected}")`)
  process.exit(1)
}

if (tag !== expected) {
  console.error(`release tag "${tag}" does not match package.json version "${version}" (expected "${expected}")`)
  process.exit(1)
}

console.log(`release tag ${tag} matches package.json version ${version}`)
