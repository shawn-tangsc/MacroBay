#!/usr/bin/env node
/**
 * Release guard: a release tag must agree with the app version in `package.json`.
 * electron-builder names artifacts from the manifest, so a mismatched tag would
 * publish a `v0.2.0` release containing `MacroBay-0.1.0-arm64.dmg`.
 *
 * Usage: node scripts/check-release-version.mjs v0.1.0
 */
import { readFileSync } from 'node:fs'

const tag = (process.argv[2] ?? '').trim()
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const expected = `v${version}`

if (tag !== expected) {
  console.error(`release tag "${tag}" does not match package.json version "${version}" (expected "${expected}")`)
  process.exit(1)
}

console.log(`release tag ${tag} matches package.json version ${version}`)
