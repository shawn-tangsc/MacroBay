import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureCalendarStandardTables, upsertCalendarStandardRow } from './marketCalendarStandardTable'
import { fillHistoricalReleaseValues } from './marketCalendarHistoricalValueFill'

const now = '2026-11-16T03:00:00.000Z'
const row = (metricKey: string, periodKey: string, scheduledDate: string) => ({
  countryCode: 'USA', metricKey, periodKey, scheduledDate, timePrecision: 'date' as const,
  status: 'missing' as const, valuesJson: '{}', sourceProviderId: 'macro-calendar-official-replay',
  sourceEventId: `${metricKey}|${periodKey}`, parserVersion: 'v1', observedAt: now, firstSeenAt: now
})

function setup(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  upsertCalendarStandardRow(database, row('US.CPI.NSA.YOY', '2026-10', '2026-11-10'))   // 该补，且能对上期次
  upsertCalendarStandardRow(database, row('US.CORE_CPI.NSA.YOY', '2026-10', '2026-11-10')) // 期次对不上（只有 09）
  upsertCalendarStandardRow(database, row('US.NONFARM.SA.CHANGE', '2026-10', '2026-11-06')) // 没登记序列
  return database
}

describe('一次性历史补值（管欠账）', () => {
  it('只补「期次严格相等且有官方观测」的行；没序列/期次不对的如实跳过，状态不跳动', async () => {
    const database = setup()
    const asked: string[] = []
    const report = await fillHistoricalReleaseValues(database, { today: '2026-11-16', nowMs: Date.parse(now),
      readLatest: async (metricKey) => {
        asked.push(metricKey)
        if (metricKey === 'US.CPI.NSA.YOY') return { period: '2026-10', value: '3.7' }
        if (metricKey === 'US.CORE_CPI.NSA.YOY') return { period: '2026-09', value: '2.6' }
        return undefined
      } })
    expect(report.filled).toBe(1)
    expect(report.skipped['period-mismatch']).toBe(1)   // 9 月不能填 10 月
    expect(report.skipped['no-series']).toBe(1)         // 非农没登记序列，不去要
    // 没登记序列的码**一次都没问**
    expect(asked).toEqual(['US.CPI.NSA.YOY', 'US.CORE_CPI.NSA.YOY'])
    const cpi = database.prepare("select status, values_json from mi_calendar_events where metric_key='US.CPI.NSA.YOY'").get() as
      { status: string; values_json: string }
    expect(cpi.status).toBe('published')
    expect(JSON.parse(cpi.values_json)).toEqual({ actual: '3.7' })
    // 期次对不上的那条**维持 missing**，不许跳回 backfilling（界面会闪）
    const core = database.prepare("select status from mi_calendar_events where metric_key='US.CORE_CPI.NSA.YOY'").get() as { status: string }
    expect(core.status).toBe('missing')
  })

  it('幂等：第二遍没有空值可补，filled 为 0、不再改变任何行', async () => {
    const database = setup()
    const readLatest = async (metricKey: string) => metricKey === 'US.CPI.NSA.YOY' ? { period: '2026-10', value: '3.7' } : undefined
    await fillHistoricalReleaseValues(database, { today: '2026-11-16', nowMs: Date.parse(now), readLatest })
    const second = await fillHistoricalReleaseValues(database, { today: '2026-11-16', nowMs: Date.parse(now), readLatest })
    expect(second.filled).toBe(0)
    // 补上的那行已经是 `published`，不在候选集合里；剩下两行仍补不到。
    expect(second.scanned).toBe(2)
  })
})
