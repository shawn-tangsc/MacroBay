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
  resolveSource: (_row: { sourceProviderId: string }) => 'Narwhal' as const,
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
    expect(event.rowKind).toBe('release')
    // 真实来源 feed id：官方行不能因为 `source` 只有两档就被标成旧源。
    expect(event.sourceFeedId).toBe('macro-calendar-bls')
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
    // eventKey 是 UUID 形状的派生键：两次派生必须一致（改过的时间不会跳回来）。
    expect(first!.eventKey).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
    expect(first!.eventKey).toBe(standardRowsToMarketEvents(rows, context)[0]!.eventKey)
    expect(first!.observationKey).toBe(rows[0]!.identityKey)
    expect(first!.sourceObservedAt).toBe('2026-11-10T13:31:00.000Z')
    // 没有名字**也不许消失**：退回码本身，读者至少看得到「这条发布存在」。
    const nameless = standardRowToMarketEvent({ ...rows[0]!, metricKey: 'UNKNOWN.CODE', identityKind: 'code',
      sourceLabel: undefined }, { ...context, resolveTitle: () => undefined })
    expect(nameless.title).toBe('UNKNOWN.CODE')
    expect(standardRowsToMarketEvents([{ ...rows[0]!, metricKey: 'UNKNOWN.CODE', identityKind: 'code',
      sourceLabel: undefined }], { ...context, resolveTitle: () => undefined })).toHaveLength(1)
  })
})

/**
 * S2：**官方行不再被贴「未核验」**。
 *
 * 标准行进分析/日历前都要过这个适配器，原来它把所有行一律写成 `observed-unverified`——
 * 官方那 51 行 high 也因此被降级。判据只有一处：`officialFeedIdOf(sourceProviderId)`。
 */
describe('coverage 按来源分流（官方 available / 数据商 observed-unverified）', () => {
  const rowFor = (sourceProviderId: string) => ({
    identityKey: `USA|US.CPI.NSA.YOY|2026-10|2026-11-10`, countryCode: 'USA',
    metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-10', firstScheduledDate: '2026-11-10',
    scheduledDate: '2026-11-10', scheduledAt: '2026-11-10T13:30:00.000Z', timePrecision: 'minute' as const,
    rowKind: 'release' as const, status: 'published' as const, identityKind: 'code' as const,
    sourceProviderId, sourceEventId: 'e-1', observedAt: '2026-11-10T13:31:00.000Z',
    values: {} as Record<string, string>
  })
  const context = { locale: 'zh' as const, resolveTitle: () => 'CPI 年率' }

  it('同一个官方行分流前是 observed-unverified、分流后是 available', () => {
    const event = standardRowToMarketEvent(rowFor('macro-calendar-bls'), context)
    // 分流判据命中官方 feed id → 不再贴未核验（改前这里固定是 observed-unverified）。
    expect(event.coverage).toBe('available')
  })

  it('数据商的行仍然是 observed-unverified（不许被这条改动顺带放开）', () => {
    expect(standardRowToMarketEvent(rowFor('narwhal'), context).coverage).toBe('observed-unverified')
  })

  it('认不出的 provider 退回 observed-unverified，不当成官方', () => {
    expect(standardRowToMarketEvent(rowFor('some-unknown-provider'), context).coverage).toBe('observed-unverified')
  })
})
