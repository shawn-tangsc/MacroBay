import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureCalendarStandardTables, upsertCalendarStandardRow } from './marketCalendarStandardTable'
import { backfillExpiredReleaseValues } from './marketCalendarReleaseValueBackfill'

const now = '2026-11-16T02:00:00.000Z'
const today = '2026-11-16'
const row = (metricKey: string, scheduledDate: string, extra: Partial<Parameters<typeof upsertCalendarStandardRow>[1]> = {}) => ({
  countryCode: 'USA', metricKey, periodKey: '2026-10', scheduledDate, timePrecision: 'minute' as const,
  scheduledAt: `${scheduledDate}T13:30:00.000Z`, status: 'scheduled' as const, valuesJson: '{}',
  sourceProviderId: 'macro-calendar-official-replay', sourceEventId: `${metricKey}|${scheduledDate}`,
  parserVersion: 'v1', observedAt: now, firstSeenAt: now, ...extra
})

function setup(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  // 过期无值的 CPI（该补）、过期无值的 FOMC（结构性无值，不许发请求）、未来行（不该动）
  upsertCalendarStandardRow(database, row('US.CPI.NSA.YOY', '2026-11-10'))
  upsertCalendarStandardRow(database, row('US.FOMC.2026-12-09', '2026-11-01', { scheduledAt: undefined, timePrecision: 'date' }))
  upsertCalendarStandardRow(database, row('US.UNEMPLOYMENT.SA.RATE', '2026-12-04'))
  return database
}

describe('发布后补值扫描', () => {
  it('拿到值 → published 且写入 actual；结构性无值不发请求；未来行不动', async () => {
    const database = setup()
    const asked: string[] = []
    const report = await backfillExpiredReleaseValues(database, { today, nowMs: Date.parse(now),
      readActual: async (metricKey) => { asked.push(metricKey); return metricKey === 'US.CPI.NSA.YOY' ? '3.7' : undefined } })
    expect(asked).toEqual(['US.CPI.NSA.YOY'])          // FOMC 不请求、未来行不请求
    expect(report.requests).toBe(1)
    expect(report.filled).toBe(1)
    expect(report.structural).toBe(1)
    const cpi = database.prepare("select status, values_json from mi_calendar_events where metric_key='US.CPI.NSA.YOY'").get() as
      { status: string; values_json: string }
    expect(cpi.status).toBe('published')
    expect(JSON.parse(cpi.values_json)).toEqual({ actual: '3.7' })
    const fomc = database.prepare("select status from mi_calendar_events where metric_key like 'US.FOMC.%'").get() as { status: string }
    expect(fomc.status).toBe('missing')
    const future = database.prepare("select status from mi_calendar_events where metric_key='US.UNEMPLOYMENT.SA.RATE'").get() as { status: string }
    expect(future.status).toBe('scheduled')
  })

  it('拿不到值：24 小时内 backfilling、超过窗口 missing；二次运行请求数不增加', async () => {
    const database = setup()
    let calls = 0
    const readActual = async () => { calls += 1; return undefined }
    const first = await backfillExpiredReleaseValues(database, { today, nowMs: Date.parse(now), readActual })
    expect(first.filled).toBe(0)
    expect(first.requests).toBe(1)
    // CPI 11-10 距 now 超过 24 小时 → 直接 missing（不再挂着待补值）
    const cpi = database.prepare("select status from mi_calendar_events where metric_key='US.CPI.NSA.YOY'").get() as { status: string }
    expect(cpi.status).toBe('missing')
    // 第二遍：没有 scheduled/backfilling/unknown 的可补行 → 不再请求
    const second = await backfillExpiredReleaseValues(database, { today, nowMs: Date.parse(now), readActual })
    expect(second.requests).toBe(0)
    expect(calls).toBe(1)
  })
})
