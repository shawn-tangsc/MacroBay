import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { looksLikeTextKey } from '../textKeyShape'

/**
 * `Tabs` / `Segmented` 的键形状守卫（契约 §7）。
 *
 * 两件组件的文案字段都是**开区间 `string`**（每个站点的标签都不同，平台枚举不出来），
 * 与 `IconButton` / `StatusPill` / `Tooltip` / `Popover` 同口径，所以由守卫保证形状：
 * `labelKey` / `ariaLabelKey` 的字面量必须是点分键，含中文、空白或已解析句子即红。
 *
 * **判据只有一份**（`../textKeyShape`），这里不另写正则。这里曾经自己写过一份「只许小写」的，
 * 于是同一个真实路径键在 `Tooltip` 通过、在 `Tabs` 报红——架构师 11-02 的裁定是「键就是真实
 * 路径、允许驼峰」，收成小写等于把产品侧的合法键判成违规。判据一旦出现第二份，
 * 产品线就只能猜「到底按哪套写」，而红会落在调用方身上、错在守卫。
 */

const ROOT = resolve(__dirname, '../../../..')
const ROOTS = ['apps', 'platform', 'products']
const SKIP = new Set(['node_modules', 'dist', 'out', 'coverage', '.git', 'build', 'release'])
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
        if (looksLikeTextKey(value)) continue
        offenders.push({ file: relative(ROOT, file), line: text.slice(0, match.index ?? 0).split('\n').length, value })
      }
    }
    expect(offenders).toEqual([])
  })

  it('cannot pass vacuously: camelCase paths are keys, a sentence and a CJK label are not', () => {
    // 这一条钉住**判据本身**，防止有人图省事把正则悄悄改回只认小写。真实路径键带驼峰是合法的：
    // 产品键就长成 `settings.intelligenceSources.viewRuns` 这样，为过守卫再翻一套全小写名字，
    // 就是同一句话两个名字——那正是要被清掉的东西。
    expect(looksLikeTextKey('ui.tabs.settings')).toBe(true)
    expect(looksLikeTextKey('settings.intelligenceSources.viewRuns')).toBe(true)
    expect(looksLikeTextKey('pages.intelligence.portal.analysisWorkspace.newChatAction')).toBe(true)
    expect(looksLikeTextKey('设置')).toBe(false)
    expect(looksLikeTextKey('Tab label with spaces')).toBe(false)
    expect(looksLikeTextKey('.leadingDot')).toBe(false)
    expect(looksLikeTextKey('noDot')).toBe(false)
  })
})
