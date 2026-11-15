import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureCalendarStandardTables, upsertCalendarStandardRow } from './marketCalendarStandardTable'
import { backfillExpiredReleaseValues, releaseValueBackfillPolicy } from './marketCalendarReleaseValueBackfill'

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
  // 过期无值的 CPI（该补；用 09 那一期，避开 2026-10 年率的「结构性无源」登记——那条单独有用例）、
  // 过期无值的 FOMC（结构性无值，不许发请求）、未来行（不该动）
  upsertCalendarStandardRow(database, row('US.CPI.NSA.YOY', '2026-10-15', { periodKey: '2026-09' }))
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

  it('2026-10 的 CPI 年率是结构性无源：不发请求、进 structural 计数、落 missing 终态', async () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    // 同一期里：年率两行结构上没有值（2025-10 CPI 从未发布，分母不存在），月率那行该去要。
    for (const metricKey of ['US.CPI.NSA.YOY', 'US.CORE_CPI.NSA.YOY', 'US.CPI.SA.MOM']) {
      upsertCalendarStandardRow(database, row(metricKey, '2026-11-10'))
    }
    const asked: string[] = []
    const report = await backfillExpiredReleaseValues(database, { today, nowMs: Date.parse(now),
      readActual: async (metricKey, periodKey) => { asked.push(`${metricKey}@${periodKey}`); return undefined } })
    // 只问月率那一条：年率两行一次请求都不许发。
    expect(asked).toEqual(['US.CPI.SA.MOM@2026-10'])
    expect(report.structural).toBe(2)
    expect(report.requests).toBe(1)
    // 终态的结构性无值行单独计数：这一轮刚落的这两条就在里面。
    expect(report.structuralAbsent).toBe(2)
    const yoy = database.prepare("select status from mi_calendar_events where metric_key='US.CPI.NSA.YOY'").get() as { status: string }
    expect(yoy.status).toBe('missing')
    // 边界：这条只登记了 2026-10 这一期，11 月那期照常去要（不许标成永久）。
    expect(releaseValueBackfillPolicy.structurallyAbsentPeriods).toEqual([
      'US.CPI.NSA.YOY|2026-10', 'US.CORE_CPI.NSA.YOY|2026-10'
    ])
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
