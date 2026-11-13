import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { standardRowToMarketEvent, standardRowsToMarketEvents } from './marketCalendarStandardEventAdapter'
import { eventTypeNameByCode, nameByMetricKey } from './marketCalendarCodeNames'
import { readStandardCalendarMonth } from './marketCalendarStandardMonthRead'
import { ensureCalendarStandardTables, upsertCalendarStandardRow, type CalendarStandardRow }
  from './marketCalendarStandardTable'

const base: CalendarStandardRow = {
  countryCode: 'USA', metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-10',
  scheduledDate: '2026-11-10', scheduledAt: '2026-11-10T13:30:00.000Z', timePrecision: 'minute',
  status: 'published', valuesJson: '{"actual":"3.7","previous":"3.4"}', valueState: 'present',
  sourceProviderId: 'macro-calendar-bls', sourceEventId: 'US.CPI.RELEASE.2026-M10',
  parserVersion: 'v1', observedAt: '2026-11-10T13:31:00.000Z', firstSeenAt: '2026-11-10T13:31:00.000Z'
}
const seed = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  upsertCalendarStandardRow(database, base)
  // 事件型：央行讲话 → central-bank-activity；名称走名表。
  upsertCalendarStandardRow(database, { ...base, metricKey: 'evt.central-bank-speech', periodKey: '2026-11-12T14:10',
    scheduledDate: '2026-11-12', scheduledAt: '2026-11-12T14:10:00.000Z', valuesJson: '{}', valueState: 'missing' })
  // 源内身份：没有标准码，名称用源原文名。
  upsertCalendarStandardRow(database, { ...base, metricKey: 'r-sec', identityKind: 'source',
    sourceLabel: 'Securities transactions', periodKey: '2026-11-18', scheduledDate: '2026-11-18',
    scheduledAt: undefined, timePrecision: 'date', valuesJson: '{}', valueState: 'missing' })
  return database
}

const context = {
  locale: 'zh' as const,
  source: 'Narwhal' as const,
  // 名称解析由装配处注入：指标码与事件码在两张名表里。
  resolveTitle: (row: { metricKey: string }) => {
    const metric = (nameByMetricKey as Record<string, { zhShort: string }>)[row.metricKey]
    if (metric !== undefined) return metric.zhShort
    const event = (eventTypeNameByCode as Record<string, { zhShort: string }>)[row.metricKey]
    return event?.zhShort
  }
}

describe('标准行 → 日历事件（queryMonth 形状不变）', () => {
  it('指标：名称走名表、类别 economic-indicator、精度与状态带上、值挂上', () => {
    const rows = readStandardCalendarMonth(seed(), { month: '2026-11' })
    const event = standardRowsToMarketEvents(rows, context).find((item) => item.eventNameKey === 'US.CPI.NSA.YOY')!
    expect(event.title).toBe('CPI 年率')
    expect(event.eventType).toBe('economic-indicator')
    expect(event.timePrecision).toBe('minute')
    expect(event.releaseStatus).toBe('published')
    expect(event.providerActual).toEqual({ displayValue: '3.7' })
  })

  it('事件码：央行讲话归 central-bank-activity；源内身份用源原文名、日期精度', () => {
    const rows = readStandardCalendarMonth(seed(), { month: '2026-11' })
    const events = standardRowsToMarketEvents(rows, context)
    const speech = events.find((item) => item.eventNameKey === 'evt.central-bank-speech')!
    expect(speech.eventType).toBe('central-bank-activity')
    const source = events.find((item) => item.title === 'Securities transactions')!
    expect(source.eventNameKey).toBeUndefined()          // 源内身份没有标准码
    expect(source.timePrecision).toBe('date')
  })

  it('身份串稳定、出处带上；没有名字的行不显示也不报错', () => {
    const rows = readStandardCalendarMonth(seed(), { month: '2026-11' })
    const [first] = standardRowsToMarketEvents(rows, context)
    expect(first!.eventKey).toBe(rows[0]!.identityKey)
    expect(first!.observationKey).toBe(rows[0]!.identityKey)
    expect(first!.sourceObservedAt).toBe('2026-11-10T13:31:00.000Z')
    expect(standardRowToMarketEvent({ ...rows[0]!, metricKey: 'UNKNOWN.CODE', identityKind: 'code',
      sourceLabel: undefined }, { ...context, resolveTitle: () => undefined })).toBeUndefined()
  })
})
