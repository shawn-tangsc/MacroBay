import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * `Tabs` / `Segmented` 的键形状守卫（契约 §7）。
 *
 * 两件组件的文案字段都是**开区间 `string`**（每个站点的标签都不同，平台枚举不出来），
 * 与 `IconButton` / `Tooltip` 同口径，所以由守卫保证形状：`labelKey` / `ariaLabelKey` 的字面量
 * 必须是点分小写键，含中文、空白或已解析句子即红。
 */

const ROOT = resolve(__dirname, '../../../..')
const ROOTS = ['apps', 'platform', 'products']
const SKIP = new Set(['node_modules', 'dist', 'out', 'coverage', '.git', 'build', 'release'])
const KEY_SHAPE = /^[a-z][a-z0-9]*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/
const OUR_IMPORTS = ['@platform/ui/components/tabs', '@platform/ui/components/segmented']
const KEY_FIELD = /\b(?:labelKey|ariaLabelKey)\s*:\s*['"`]([^'"`\n]*)['"`]/g

function files(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue
      out.push(...files(join(dir, entry.name)))
      continue
    }
    if (!/\.tsx$/.test(entry.name) || /\.test\.tsx$/.test(entry.name)) continue
    out.push(join(dir, entry.name))
  }
  return out
}

const scanned = ROOTS.flatMap((root) => files(join(ROOT, root)))

describe('Choice component keys', () => {
  it('only ever passes key-shaped strings for labels and group names', () => {
    const offenders: Array<{ file: string; line: number; value: string }> = []
    for (const file of scanned) {
      const text = readFileSync(file, 'utf8')
      if (!OUR_IMPORTS.some((entry) => text.includes(entry))) continue
      for (const match of text.matchAll(KEY_FIELD)) {
        const value = match[1] ?? ''
        if (KEY_SHAPE.test(value)) continue
        offenders.push({ file: relative(ROOT, file), line: text.slice(0, match.index ?? 0).split('\n').length, value })
      }
    }
    expect(offenders).toEqual([])
  })

  it('cannot pass vacuously: a sentence and a CJK label are rejected', () => {
    const bad = ['ui.tabs.settings', '设置', 'Tab label with spaces'].filter((value) => !KEY_SHAPE.test(value))
    expect(bad).toHaveLength(2)
  })
})
