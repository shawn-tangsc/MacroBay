import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const sharedOpener = join(repoRoot, 'platform/storage/sqlite/openSqliteDatabase.ts')

/**
 * 所有本地 SQLite 库都必须经过 `openSqliteDatabase` 打开。
 *
 * 这条守卫针对的是"第 17 个库又漏掉"：只要有人再写一处 `new DatabaseSync(`，就不再有统一的
 * WAL 与 `busy_timeout`，而且不会立刻报错——直到第二个写入者出现才丢写。测试文件不在此列：
 * 它们为了核对 pragma 与文件内容，本来就该直接打开。
 */
describe('sqlite open path boundary', () => {
  it('has no production module opening a SQLite database outside the shared opener', () => {
    const offenders = [
      ...listSourceFiles(join(repoRoot, 'platform')),
      ...listSourceFiles(join(repoRoot, 'products'))
    ]
      .filter((filePath) => filePath !== sharedOpener)
      .filter((filePath) => readFileSync(filePath, 'utf8').includes('new DatabaseSync('))
      .map((filePath) => relative(repoRoot, filePath))

    expect(offenders).toEqual([])
  })

  it('keeps the shared opener itself free of product imports', () => {
    const source = readFileSync(sharedOpener, 'utf8')

    expect(source).not.toMatch(/@products\/|from ['"][^'"]*products\//)
  })
})

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return []
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) return listSourceFiles(fullPath)
    if (!(entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) return []
    if (entry.name.includes('.test.')) return []
    return [fullPath]
  })
}
