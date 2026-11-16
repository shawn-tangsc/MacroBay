import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureCalendarStandardTables, upsertCalendarStandardRow } from '../marketCalendarStandardTable'
import { readCalendarMappingRules } from './marketCalendarMappingRulesRead'

/**
 * 映射规则表读口（用户 2026-11-16 要看的那张表）：两段 + 三个计数 + 官方查看地址。
 *
 * 边界：`basis`/`officialUrl` **推不出就必须 null**（不许拿聚合站或猜的页凑）；
 * `unmapped` 由服务端按行数排好；计数由服务端给（前端不自己数，否则筛选后标题会对不上）。
 */
const now = '2026-11-16T14:00:00.000Z'

function seed(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  // 一个数组身份、两行（中英各一）：未映射段应为 rowCount 2。
  for (const [suffix, label] of [['79090', '11月纽约联储制造业指数'], ['79095', 'New York Fed manufacturing index']] as const) {
    upsertCalendarStandardRow(database, {
      countryCode: 'US', metricKey: `["214790",${suffix}]`, periodKey: '2026-11-16T13:30',
      scheduledDate: '2026-11-16', timePrecision: 'minute' as const, status: 'backfilling' as const,
      valuesJson: '{}', identityKind: 'source' as const, sourceLabel: label,
      sourceProviderId: '0xrouter', sourceEventId: `x-${suffix}`, parserVersion: 'v1', observedAt: now, firstSeenAt: now
    })
  }
  return database
}

describe('映射规则表读口', () => {
  it('已映射 85 条：字段齐、计数由服务端给、依据推不出就 null', () => {
    const read = readCalendarMappingRules(seed())
    if (read.state !== 'available') throw new Error('unavailable')
    expect(read.mapped).toHaveLength(85)
    expect(read.counts.mapped).toBe(85)
    // BLS 的 CPI 有官方页（机构 + 页面类型能推），ISM 那类推不出必须 null
    const cpi = read.mapped.find((rule) => rule.metricKey === 'US.CPI.NSA.YOY')!
    expect(cpi.officialUrl).toBe('https://www.bls.gov/news.release/')
    expect(cpi.basis).toContain('BLS')
    const ism = read.mapped.find((rule) => rule.metricKey === 'US.ISM_MANUFACTURING.SA.LEVEL')!
    expect(ism.officialUrl).toBeNull()
    expect(ism.basis).toBeNull()
  })

  it('未映射段按行数从大到小排，中英两条算 2 行、只出一个 id', () => {
    const read = readCalendarMappingRules(seed())
    if (read.state !== 'available') throw new Error('unavailable')
    expect(read.unmapped).toEqual([{ sourceId: '214790', rowCount: 2, sampleLabel: '11月纽约联储制造业指数' }])
    expect(read.counts.unmapped).toBe(1)
    expect(read.counts.unmappedRows).toBe(2)
  })
})
