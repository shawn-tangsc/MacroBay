import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureCalendarStandardTables, upsertCalendarStandardRow } from '../marketCalendarStandardTable'
import { readCalendarEventIndex } from './marketCalendarEventIndexRead'

/**
 * 事件清单读口（渲染专用）的三条判据（Chief 2026-11-16）：
 * ① 空数组只表示「没有匹配」，读不到给 `unavailable`；
 * ② `total` = 实际可翻到的行数（把页翻完，行数之和等于 total）；
 * ③ 游标排序带**唯一 tiebreaker**：同日事件很多，只按日期排会翻出重复或漏行。
 */
const today = '2026-11-16'

const row = (metricKey: string, periodKey: string, scheduledDate: string, extra: Partial<Parameters<typeof upsertCalendarStandardRow>[1]> = {}) => ({
  countryCode: 'US', metricKey, periodKey, scheduledDate, timePrecision: 'date' as const,
  status: 'published' as const, valuesJson: '{"actual":"1"}', sourceProviderId: 'narwhal',
  sourceEventId: `${metricKey}|${periodKey}`, parserVersion: 'v1',
  observedAt: `${scheduledDate}T00:00:00.000Z`, firstSeenAt: `${scheduledDate}T00:00:00.000Z`, ...extra
})

function seed(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  // 三个事件，其中两个「最近一次发布」在同一天——这正是 tiebreaker 要处理的那批。
  upsertCalendarStandardRow(database, row('US.CPI.NSA.YOY', '2026-09', '2026-10-10'))
  upsertCalendarStandardRow(database, row('US.CPI.NSA.YOY', '2026-10', '2026-11-10'))
  upsertCalendarStandardRow(database, row('US.NONFARM.SA.CHANGE', '2026-10', '2026-11-10'))
  upsertCalendarStandardRow(database, row('US.UNEMPLOYMENT.SA.RATE', '2026-10', '2026-11-10', { countryCode: 'USA' }))
  // 未来一期：作为 nextRelease
  upsertCalendarStandardRow(database, row('US.CPI.NSA.YOY', '2026-11', '2026-12-10', { status: 'scheduled', valuesJson: '{}' }))
  // 没有名表条目的身份：只有源原文名。
  upsertCalendarStandardRow(database, row('["212058",70663]', '2026-09', '2026-10-01', {
    countryCode: 'DE', identityKind: 'source', sourceLabel: 'transmutation in seasonally adjusted unemployment'
  }))
  return database
}

describe('事件清单读口（一行一个事件身份）', () => {
  it('一个身份一行；最近一次发布与下一次发布都带上（不是把发布展开）', () => {
    const read = readCalendarEventIndex(seed(), { today })
    expect(read.state).toBe('available')
    if (read.state !== 'available') return
    expect(read.total).toBe(4)   // CPI 三期合成一行：事件=身份，不按期展开
    const cpi = read.rows.find((entry) => entry.metricKey === 'US.CPI.NSA.YOY')!
    expect(cpi.lastRelease?.date).toBe('2026-11-10')
    expect(cpi.nextRelease?.date).toBe('2026-12-10')
    expect(cpi.period).toBe('2026-10')
    expect(cpi.zhShort).toBeDefined()
    expect(cpi.enShort).toBeDefined()   // 一对名字都给（中英过滤要用）
    // 没有名表条目的：退回源原文名，并标出来
    const fallback = read.rows.find((entry) => entry.titleIsSourceLabel)!
    expect(fallback.sourceLabel).toContain('transmutation')
    expect(fallback.zhShort).toBeUndefined()
  })

  it('分页：翻到底的行数之和 = total，同一天的事件不重复也不漏', () => {
    const database = seed()
    const seen: string[] = []
    let cursor: string | undefined
    let total = 0
    for (let page = 0; page < 10; page += 1) {
      const read = readCalendarEventIndex(database, { today, pageSize: 2, ...(cursor === undefined ? {} : { cursor }) })
      if (read.state !== 'available') throw new Error('unavailable')
      total = read.total
      seen.push(...read.rows.map((entry) => entry.key))
      if (read.nextCursor === undefined) break
      cursor = read.nextCursor
    }
    expect(seen).toHaveLength(total)                 // ② 行数之和 = total
    expect(new Set(seen).size).toBe(seen.length)     // ③ 没有重复（tiebreaker 生效）
  })

  it('筛选：中英名都能搜到；国家独立筛；空数组只表示「没有匹配」', () => {
    const database = seed()
    // 中文简称搜
    expect(readCalendarEventIndex(database, { today, nameQuery: '非农' })).toMatchObject({ state: 'available' })
    // 英文也搜得到（大小写不敏感）
    const english = readCalendarEventIndex(database, { today, nameQuery: 'payrolls' })
    expect(english.state === 'available' && english.rows.length).toBe(1)
    // 国家独立筛（不混进名字框）
    const de = readCalendarEventIndex(database, { today, countryCode: 'DE' })
    expect(de.state === 'available' && de.total).toBe(1)
    // 搜不到 = 空数组（available），不是 unavailable
    expect(readCalendarEventIndex(database, { today, nameQuery: 'zzz-不存在' }))
      .toMatchObject({ state: 'available', rows: [], total: 0 })
  })
})
