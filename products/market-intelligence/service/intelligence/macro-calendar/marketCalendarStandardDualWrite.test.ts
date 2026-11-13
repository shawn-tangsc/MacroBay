import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'

import { dualWriteObservationBatch } from './marketCalendarStandardDualWrite'
import { ensureCalendarStandardTables } from './marketCalendarStandardTable'
import { narwhalSourceEventIdForIdentity } from './marketCalendarMetricIdentity'

const key = (metricKey: string, periodKey = '2026-10') =>
  JSON.stringify(['narwhal', 'macro-calendar-narwhal-economic-data', 'zh',
    JSON.parse(narwhalSourceEventIdForIdentity({ countryCode: 'USA', metricKey, periodKey }))])
const draft = (metricKey: string) => ({ marketFactKey: key(metricKey), kind: 'economic-indicator',
  displayName: 'CPI', countryCode: 'US', scheduledAt: '2026-11-10T13:30:00.000Z', scheduledDate: '2026-11-10',
  providerActual: { displayValue: '3.7' }, providerPrevious: { displayValue: '3.4' } })

const batch = (drafts: readonly object[]) => ({ providerId: 'narwhal', parserVersion: 'v1',
  observedAt: '2026-11-10T13:31:00.000Z', drafts: drafts as never })

describe('观测 → 标准 双写', () => {
  it('身份解析成功 → 写标准行；解析不出 → 进 unmapped 并有 reason', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const counts = dualWriteObservationBatch(database, batch([
      draft('US.CPI.NSA.YOY'),
      { marketFactKey: JSON.stringify(['narwhal', 'd', 'zh', ['001530fb-87a1-4aa3-8be0-30eeaf9344b1', 1]]) }
    ]))
    expect(counts.written).toBe(1)
    expect(counts.unmapped['bad-identity']).toBe(1)
    expect(counts.failed).toBe(0)
    expect((database.prepare('select count(*) c from mi_calendar_events').get() as { c: number }).c).toBe(1)
    expect((database.prepare('select count(*) c from mi_calendar_unmapped').get() as { c: number }).c).toBe(1)
  })

  it('写标准表失败 → 只计数 + 记日志，不抛（采集不被拖停）', () => {
    const database = new DatabaseSync(':memory:')
    // 故意不建表：写入必然抛错。
    const onError = vi.fn()
    const counts = dualWriteObservationBatch(database, batch([draft('US.CPI.NSA.YOY')]), { onError })
    expect(counts.failed).toBe(1)
    expect(counts.written).toBe(0)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('同一个身份重放两次 → 仍是一行（覆盖不是新增）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    dualWriteObservationBatch(database, batch([draft('US.CPI.NSA.YOY')]))
    dualWriteObservationBatch(database, batch([draft('US.CPI.NSA.YOY')]))
    expect((database.prepare('select count(*) c from mi_calendar_events').get() as { c: number }).c).toBe(1)
  })
})

describe('事件型：源类型串 → evt.* 码', () => {
  const eventDraft = (displayName: string, at: string) => ({
    marketFactKey: JSON.stringify(['narwhal', 'macro-calendar-narwhal-central-bank-activities', 'zh',
      JSON.parse(narwhalSourceEventIdForIdentity({ countryCode: 'USA',
        metricKey: 'central-bank-activity', periodKey: at }))]),
    kind: 'central-bank-activity', displayName, countryCode: 'US', scheduledAt: at, scheduledDate: at.slice(0, 10)
  })

  it('已知类型串 → 落标准表，periodKey 取时刻到分钟', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const counts = dualWriteObservationBatch(database, batch([eventDraft('Central bank speech', '2026-11-13T14:10:00.000Z')]))
    expect(counts.written).toBe(1)
    const row = database.prepare('select metric_key, period_key, time_precision from mi_calendar_events').get() as
      { metric_key: string; period_key: string; time_precision: string }
    expect(row.metric_key).toBe('evt.central-bank-speech')
    expect(row.period_key).toBe('2026-11-13T14:10')
    expect(row.time_precision).toBe('minute')
  })

  it('未知类型串 → 不猜，落 unknown-event-type', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const counts = dualWriteObservationBatch(database, batch([eventDraft('Some new type', '2026-11-13T15:00:00.000Z')]))
    expect(counts.written).toBe(0)
    expect(counts.unmapped['unknown-event-type']).toBe(1)
  })
})
