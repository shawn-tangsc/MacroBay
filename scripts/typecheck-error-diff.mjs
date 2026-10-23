#!/usr/bin/env node
/**
 * Compares two `pnpm typecheck` logs by error identity, ignoring line and column.
 *
 * Line numbers shift whenever a comment or an import is added, so a line-based diff
 * reports a pre-existing error as new (that happened during the 0xRouter admission
 * work). This script keys each error by file, error code and message text, which stay
 * stable across edits, and prints what actually appeared or disappeared.
 *
 * Usage:
 *   pnpm typecheck > /tmp/tc-before.log 2>&1
 *   pnpm typecheck > /tmp/tc-after.log 2>&1
 *   node scripts/typecheck-error-diff.mjs /tmp/tc-before.log /tmp/tc-after.log
 *
 * Exit code is 1 when the change introduced errors, so it can gate a commit.
 */
import { readFileSync } from 'node:fs'

const [, , beforePath, afterPath] = process.argv

if (!beforePath || !afterPath) {
  console.error('usage: node scripts/typecheck-error-diff.mjs <before.log> <after.log>')
  process.exit(2)
}

/** `path(line,col): error TS1234: message` -> a position-free identity. */
function parseErrors(logPath) {
  const text = readFileSync(logPath, 'utf8')
  const errors = new Map()
  const duplicates = new Map()
  for (const line of text.split('\n')) {
    const match = /^(?<file>[^(]+)\(\d+,\d+\): error (?<code>TS\d+): (?<message>.*)$/.exec(line.trim())
    if (!match?.groups) continue
    const { file, code, message } = match.groups
    const identity = `${file.trim()}|${code}|${message.trim()}`
    // The same error can legitimately be reported at several positions in one file.
    duplicates.set(identity, (duplicates.get(identity) ?? 0) + 1)
    errors.set(identity, { file: file.trim(), code, message: message.trim(), count: duplicates.get(identity) })
  }
  return errors
}

const before = parseErrors(beforePath)
const after = parseErrors(afterPath)

const introduced = [...after.keys()].filter(identity => !before.has(identity))
const resolved = [...before.keys()].filter(identity => !after.has(identity))

console.log(`before: ${before.size} distinct error(s)`)
console.log(`after:  ${after.size} distinct error(s)`)
console.log(`introduced: ${introduced.length}`)
for (const identity of introduced) console.log(`  + ${after.get(identity).file} ${after.get(identity).code}: ${after.get(identity).message.slice(0, 140)}`)
console.log(`resolved: ${resolved.length}`)
for (const identity of resolved) console.log(`  - ${before.get(identity).file} ${before.get(identity).code}: ${before.get(identity).message.slice(0, 140)}`)

process.exit(introduced.length > 0 ? 1 : 0)
