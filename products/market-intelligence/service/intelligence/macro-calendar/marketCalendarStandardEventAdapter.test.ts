import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { standardRowToMarketEvent, standardRowsToMarketEvents } from './marketCalendarStandardEventAdapter'
import { resolveStandardRowTitle } from '../../wiring/calendarReadings'
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

describe('0xRouter 三路：来源认得出、国家名算得出（2026-11-16）', () => {
  it('经济指标行 → 它那一路的 feed id，不再落 `unspecified`；国家名两种写法都认', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    // 观测表里 0xrouter 的行记的是 provider `0xrouter`、国家码两种写法并存（US / USA）。
    upsertCalendarStandardRow(database, { ...base, countryCode: 'USA', sourceProviderId: '0xrouter',
      metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-10', scheduledDate: '2026-11-10',
      scheduledAt: '2026-11-10T13:30:00.000Z', valuesJson: '{"actual":"3.7"}', valueState: 'present' })
    upsertCalendarStandardRow(database, { ...base, countryCode: 'US', sourceProviderId: '0xrouter',
      metricKey: 'US.CPI.SA.MOM', periodKey: '2026-10', scheduledDate: '2026-11-10',
      scheduledAt: '2026-11-10T13:30:00.000Z', valuesJson: '{"actual":"0.3"}', valueState: 'present' })
    // 事件型：讲话 → 央行活动那一路。
    upsertCalendarStandardRow(database, { ...base, countryCode: 'US', sourceProviderId: '0xrouter',
      metricKey: 'evt.central-bank-speech', periodKey: '2026-11-10T14:35', scheduledDate: '2026-11-10',
      scheduledAt: '2026-11-10T14:35:00.000Z', valuesJson: '{}', valueState: 'missing' })
    const events = standardRowsToMarketEvents(readStandardCalendarMonth(database, { month: '2026-11' }), context)
    const byMetric = new Map(events.map((event) => [event.title, event]))
    const cpi = events.find((event) => event.eventNameKey === 'US.CPI.NSA.YOY')!
    // ① 来源是它自己那一路，不是「未知来源」。
    expect(cpi.source).toBe('macro-calendar-0xrouter-economic-data')
    expect(cpi.sourceFeedId).toBe('macro-calendar-0xrouter-economic-data')
    expect(cpi.source).not.toBe('unspecified')
    // ② 国家名按码算出来，`USA` 与 `US` 都认（名表以 alpha-2 为键）。
    expect(cpi.countryName).toBe('美国')
    const mom = events.find((event) => event.eventNameKey === 'US.CPI.SA.MOM')!
    expect(mom.countryName).toBe('美国')
    const speech = events.find((event) => event.eventType === 'central-bank-activity' && event.sourceFeedId !== undefined)!
    expect(speech.source).toBe('macro-calendar-0xrouter-central-bank-activities')
    expect(byMetric.size).toBeGreaterThan(0)
  })

  it('认不出的 provider 仍是 `unspecified`（不为修这条把所有未知都当市场源）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, { ...base, sourceProviderId: 'some-unknown-provider',
      sourceEventId: 'unknown-1' })
    const [event] = standardRowsToMarketEvents(readStandardCalendarMonth(database, { month: '2026-11' }),
      { ...context, resolveSource: undefined })
    expect(event!.source).toBe('unspecified')
    expect(event!.sourceFeedId).toBeUndefined()
  })
})

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

/**
 * 指标层级：由适配器从层级表搬过来（用户 2026-11-17）。
 *
 * 判据三条：子项带母中文名、母项带按词表序的分项、普通指标**没有这个字段**（详情整行不显示）。
 */
describe('指标层级随事件一起下发', () => {
  const phillyChild = 'US.PHILLY_FED_MANUFACTURING.SHIPMENTS.SA.LEVEL'
  const phillyParent = 'US.PHILLY_FED_MANUFACTURING.SA.LEVEL'
  const read = (): ReturnType<typeof standardRowsToMarketEvents> => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    for (const metricKey of [phillyChild, phillyParent, 'US.CPI.NSA.YOY']) {
      upsertCalendarStandardRow(database, { ...base, metricKey, periodKey: '2026-11',
        scheduledAt: '2026-11-16T13:30:00.000Z', valuesJson: '{"actual":"1"}', valueState: 'present' })
    }
    return standardRowsToMarketEvents(readStandardCalendarMonth(database, { month: '2026-11' }), context)
  }

  it('gives a child its parent name and a parent its children in word order', () => {
    const events = read()
    const child = events.find((event) => event.eventNameKey === phillyChild)!
    const parent = events.find((event) => event.eventNameKey === phillyParent)!
    expect(child.hierarchy?.kind).toBe('child')
    expect(child.hierarchy?.parentName).toContain('费城联储制造业')
    expect(parent.hierarchy?.kind).toBe('parent')
    // 词表序：装船在第一位（不是字母序，也不是行数序）。
    expect(parent.hierarchy?.childNames?.[0]).toContain('装船')
    expect((parent.hierarchy?.childNames ?? []).length).toBeGreaterThan(1)
  })

  it('leaves an ordinary metric without the field at all', () => {
    const cpi = read().find((event) => event.eventNameKey === 'US.CPI.NSA.YOY')!
    expect('hierarchy' in cpi).toBe(false)
  })
})

describe('审计身份（用户 2026-11-20）', () => {
  it('码身份的事件带上 periodKey / firstScheduledDate（从写入身份搬出来，不重算）', () => {
    const database = seed()
    const events = standardRowsToMarketEvents(readStandardCalendarMonth(database, { month: '2026-11' }), context)
    const cpi = events.find((event) => event.eventNameKey === 'US.CPI.NSA.YOY')!
    expect(cpi.periodKey).toBe('2026-10')
    expect(cpi.firstScheduledDate).toBe('2026-11-10')
  })

  it('无身份的行（讲活/源内身份）不带这两个键——不是空串', () => {
    const database = seed()
    const events = standardRowsToMarketEvents(readStandardCalendarMonth(database, { month: '2026-11' }), context)
    const speech = events.find((event) => event.eventType === 'central-bank-activity')!
    expect('periodKey' in speech).toBe(false)
    expect('firstScheduledDate' in speech).toBe(false)
  })
})

describe('国家全名（读屏用）', () => {
  it('有国家的事件带 countryNameFull；没有国家的事件不带这个键（不是空串）', () => {
    const database = seed()
    const events = standardRowsToMarketEvents(readStandardCalendarMonth(database, { month: '2026-11' }), context)
    const cpi = events.find((event) => event.eventNameKey === 'US.CPI.NSA.YOY')!
    // 中文界面：显示值与全名都是「美国」；英文界面显示 `US`、全名 `United States`（同一张表两种粒度）。
    expect(cpi.countryNameFull).toBe('美国')
    // 没有国家：投影不带这个键——组件据此不写 title / aria-label。
    const noCountry = standardRowsToMarketEvents(
      readStandardCalendarMonth(database, { month: '2026-11' }).map((row) => ({ ...row, countryCode: '' })), context)
    expect(noCountry.length).toBeGreaterThan(0)
    expect(noCountry.every((event) => !('countryNameFull' in event))).toBe(true)
  })
})

describe('英文界面不出中文名（用户 2026-11-20）', () => {
  // **直接调线上那个函数**，不在测试里复刻规则——复刻的规则一旦与线上分叉，用例仍会全绿。
  const localized = (locale: 'zh' | 'en') => ({
    ...context, locale,
    resolveTitle: (row: { metricKey: string }, at: 'zh' | 'en') => resolveStandardRowTitle(row, at)
  } as never)

  it('locale=en 时每个标题都不含 CJK，且非空；locale=zh 与原来逐条一致', () => {
    const database = seed()
    const rows = readStandardCalendarMonth(database, { month: '2026-11' })
    const en = standardRowsToMarketEvents(rows, localized('en'))
    const zh = standardRowsToMarketEvents(rows, localized('zh'))
    expect(en.length).toBeGreaterThan(0)
    expect(en.every((event) => event.title.trim().length > 0)).toBe(true)
    expect(en.filter((event) => /[\u4e00-\u9fff]/.test(event.title)).map((event) => event.title)).toEqual([])
    // 中文侧与改动前一致：指标码走中文短名。
    expect(zh.find((event) => event.eventNameKey === 'US.CPI.NSA.YOY')!.title).toBe('CPI 年率')
  })
})
