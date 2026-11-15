import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * **单一写入口棘轮**（契约 §9 第 1 条）。
 *
 * 标准表的写入必须只有一条路：`mi_calendar_events` 的 SQL 只许出现在标准表那个文件里，
 * 生产代码里调用写入端的点**恰好 1 处**（`dualWriteMeasureRows` 里那一处）。
 *
 * 这是**棘轮**：今天通过，将来任何人多加一个写入入口就红。红不是让你把断言数字改大，
 * 而是让你回答「为什么这件事需要第二条写入口」；答不上来就并回那一条路。
 * 今晚已经删掉过一条后门（`dualWriteObservationBatch`，0 调用者、没有零值判据）。
 */
const PRODUCT = new URL('../../../../', import.meta.url).pathname
const STANDARD_TABLE_FILE = 'service/intelligence/macro-calendar/marketCalendarStandardTable.ts'
const WRITER = 'upsertCalendarStandardRow'

function productionFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__baselines__') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { productionFiles(full, out); continue }
    if ((entry.endsWith('.ts') || entry.endsWith('.tsx')) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

describe('标准表只有一个写入口', () => {
  it('写 mi_calendar_events 的 SQL 只出现在标准表那个文件里', () => {
    const offenders = productionFiles(PRODUCT)
      .filter((file) => relative(PRODUCT, file) !== STANDARD_TABLE_FILE)
      .filter((file) => /insert\s+(or\s+replace\s+)?into\s+mi_calendar_events\b/i.test(readFileSync(file, 'utf8')))
      .map((file) => relative(PRODUCT, file))
    expect(offenders, `只有 ${STANDARD_TABLE_FILE} 可以直接写标准表；这些文件绕过了它：\n${offenders.join('\n')}`)
      .toEqual([])
  })

  it('生产代码里调用写入端的点恰好 1 处（多一处就红）', () => {
    const callSites = productionFiles(PRODUCT).flatMap((file) =>
      readFileSync(file, 'utf8').split('\n')
        .map((line, index) => ({ line, index: index + 1 }))
        .filter(({ line }) => line.includes(`${WRITER}(`) && !line.trimStart().startsWith('export function'))
        .map(({ index }) => `${relative(PRODUCT, file)}:${index}`))
    expect(callSites, `标准表写入端只许有一处生产调用点，现在有 ${callSites.length} 处：\n${callSites.join('\n')}`)
      .toHaveLength(1)
  })
})
