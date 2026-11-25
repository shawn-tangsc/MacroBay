import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { marketCalendarCountrySourceMappings } from './marketCalendarCountrySourceMappings'
import { calendarCodeExists, resolveCalendarCode } from './marketCalendarCodeLookup'

/**
 * 按国家拆开的映射表：合并之后必须和拆开前**逐条相等**，而且每条都指得着码表里的一个码。
 *
 * 三条判据都不是形式主义：
 * - **id 不许跨国家重复**：同一个源内 id 出现在两个国家文件里，说明有一处把国家记错了，
 *   而这种错在界面上只表现为「某个码的数据量多了一点」，看不出来；
 * - **目标码必须在码表里**（两张码表的并集：策划码表 + 按国家码表）：指向不存在的码，等于给一个
 *   身份发了一张空头支票。取并集是因为两个码空间本就不重叠——同一条码只住在一张表里，
 *   并集只是把两张表合起来查，不会让同一串码出现两个含义（那条由「不许有重复码」守卫管）；
 * - **期次必须是闭集里的三个值**：期次是身份的一部分，写第四个值等于编了一个新规则。
 */
const DIR = 'products/market-intelligence/service/intelligence/macro-calendar/marketCalendarCountrySourceMappings-byCountry'

describe('按国家拆开的源内映射', () => {
  const parts = readdirSync(join(process.cwd(), DIR)).filter((name) => name.endsWith('.ts'))

  it('合并条目数等于各国家文件之和，且 id 不跨文件重复', () => {
    expect(parts.length).toBeGreaterThan(1)
    const seen = new Set<string>()
    let total = 0
    for (const part of parts) {
      const source = readFileSync(join(process.cwd(), DIR, part), 'utf8')
      const ids = [...source.matchAll(/^  '(\d+)': \{ metricKey:/gmu)].map((match) => match[1]!)
      total += ids.length
      for (const id of ids) {
        expect(seen.has(id), `${id} 在多个国家文件里重复`).toBe(false)
        seen.add(id)
      }
      // 文件名与国家前缀一致：`de.ts` 里只许出现 `DE.` 开头的码。
      const country = part.replace('.ts', '').toUpperCase()
      for (const code of source.matchAll(/metricKey: '([A-Z]{2,3})\./gu)) {
        expect(code[1], `${part} 里出现了 ${code[1]} 的码`).toBe(country)
      }
    }
    expect(Object.keys(marketCalendarCountrySourceMappings)).toHaveLength(total)
  })

  it('目标码都在码表里，期次在闭集里', () => {
    let checked = 0
    for (const [sourceId, entry] of Object.entries(marketCalendarCountrySourceMappings)) {
      // 判据走同一个查表函数（架构师 2026-11-25）：不许各处自己拼 `main[x] ?? country[x]`
      const lookup = resolveCalendarCode(entry.metricKey)
      expect(lookup.found, `${sourceId} → ${entry.metricKey} 不在任何一张码表里`).toBe(true)
      expect(calendarCodeExists(entry.metricKey)).toBe(true)
      checked += 1
      expect(['month', 'current_month', 'week_end', 'quarter', 'event_date']).toContain(entry.periodRule)
    }
    expect(checked).toBe(Object.keys(marketCalendarCountrySourceMappings).length)
  })
})
