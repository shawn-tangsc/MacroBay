import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 基线是**存量豁免**：文件没了，就不该继续被豁免。
 *
 * 真实事故：`DailyBriefingSettingsDrawer.tsx` 删掉之后，它的 `platformNote` 豁免还留在 JSON 里——
 * 谁也看不见的一条永久豁免，下一个人再写出同样的说明句，门禁会拿一条幽灵当「已登记」。
 *
 * 所以这里只做一件事：基线里**每一条引用的文件必须在仓库里存在**，不存在就红，并报出条目与路径。
 */
const ROOT = process.cwd()

function loadEntries(): Readonly<Record<string, number>> {
  return (JSON.parse(readFileSync(join(ROOT, 'scripts/body-prose-baseline.json'), 'utf8')) as { entries: Record<string, number> }).entries
}

/** 纯函数：条目 → 指向已不存在文件的条目（`条目（文件）`）。 */
export function deadEntries(entries: Readonly<Record<string, number>>): string[] {
  return Object.keys(entries).flatMap((entry) => {
    const file = entry.split(' :: ')[0] ?? ''
    return existsSync(join(ROOT, file)) ? [] : [`${entry}（${file}）`]
  })
}

describe('the body-prose baseline only exempts files that exist', () => {
  it('flags an entry whose file is gone', () => {
    expect(deadEntries({ 'pages/intelligence/DeletedDrawer.tsx :: platformNote': 1 })).toEqual([
      'pages/intelligence/DeletedDrawer.tsx :: platformNote（pages/intelligence/DeletedDrawer.tsx）'
    ])
  })

  it('accepts an entry whose file is still there', () => {
    expect(deadEntries({ 'scripts/body-prose-baseline.json :: note': 1 })).toEqual([])
  })

  it('keeps the real baseline free of dead entries', () => {
    expect(deadEntries(loadEntries())).toEqual([])
  })
})
