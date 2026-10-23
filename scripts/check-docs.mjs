#!/usr/bin/env node
/**
 * Public documentation guard:
 *  - every English page has a paired .zh-CN.md (and vice versa);
 *  - every relative Markdown link resolves in the current checkout.
 * External URLs and anchors are ignored.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const root = resolve(process.cwd(), 'docs')
const failures = []

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.md') ? [path] : []
  })
}

const files = walk(root)
const fileSet = new Set(files)

for (const file of files) {
  const pair = file.endsWith('.zh-CN.md')
    ? file.slice(0, -'.zh-CN.md'.length) + '.md'
    : file.slice(0, -'.md'.length) + '.zh-CN.md'
  if (!fileSet.has(pair)) failures.push(`missing language pair: ${relative(process.cwd(), file)}`)

  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1]
    if (/^(https?:|mailto:|#)/.test(target)) continue
    const path = target.split('#', 1)[0]
    if (!path) continue
    const resolved = path.startsWith('/') ? resolve(process.cwd(), `.${path}`) : resolve(dirname(file), path)
    try {
      statSync(resolved)
    } catch {
      failures.push(`broken link: ${relative(process.cwd(), file)} -> ${target}`)
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(`docs check passed (${files.length} files)`)
