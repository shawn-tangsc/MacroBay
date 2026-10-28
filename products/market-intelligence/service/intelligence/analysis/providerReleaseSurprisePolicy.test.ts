import { describe, expect, it } from 'vitest'

import type { MacroCalendarProviderObservation } from '../macro-calendar/marketCalendarObservationNormalization'
import { marketCalendarSurprisePolicy } from '../../../contracts/macro/marketCalendarSurprise'
import { providerReleaseSurprisePolicy, providerReleaseSurprises, providerSurpriseBaselineKey } from './providerReleaseSurprisePolicy'

/**
 * provider 发布只在显著偏离预期时进触发流（设计 145 §8 A / 146 §2 选项 3）。
 *
 * 值取自产品真实库里的观测（`macro-calendar.sqlite` 的
 * `mi_macro_calendar_market_event_observations`，2026-10-15 那一批），因为这条口径是从那批数据来的：
 * 核心 PPI 年率 5.0% vs 预期 4.4% —— 读者问"为什么什么都没发生"的就是它。
 */
const asOf = '2026-10-15T13:10:00.000Z'
const previousAsOf = '2026-10-15T12:00:00.000Z'

function observation(overrides: Record<string, unknown> = {}): MacroCalendarProviderObservation {
  return {
    eventKey: 'market-observation-1', releaseGroupKey: 'market-observation-1', eventFamily: 'economic-indicator',
    titleKey: '9月核心生产者物价指数(年率)', countryCode: 'US', importance: 'high', periodKey: '2026-M09',
    lifecycleState: 'released', coverage: 'partial', scheduledDate: '2026-10-15', scheduledAt: '2026-10-15T12:30:00.000Z',
    releaseTimeSource: 'date-only', detectedAt: '2026-10-15T13:09:55.528Z', actual: { displayValue: '5.0%' },
    consensus: { displayValue: '4.4%' }, consensusState: 'available', surprise: 'beat',
    providerIds: ['macro-calendar-0xrouter-economic-data'],
    caveats: ['observed-unverified', 'provider-title-is-display-name'],
    ...overrides
  } as MacroCalendarProviderObservation
}

const surprises = (observations: readonly MacroCalendarProviderObservation[], previous: ReadonlyMap<string, string | null> | null = null, previousAsOf_: string | null = previousAsOf) =>
  providerReleaseSurprises({ observations, previous, previousAsOf: previousAsOf_, asOf })

describe('a provider release that surprised the market', () => {
  it('counts the one the reader asked about, and keeps it as a provider observation', () => {
    const [surprise] = surprises([observation()])
    expect(surprise).toMatchObject({
      eventKey: 'market-observation-1', titleKey: '9月核心生产者物价指数(年率)',
      actual: '5.0%', consensus: '4.4%', suffix: '%'
    })
    expect(surprise?.difference).toBeCloseTo(0.6, 10)
    // 文案与事实都不得把它说成官方来源：名字是 provider 自己的那一串。
    expect(surprise?.title).toBe('9月核心生产者物价指数(年率)')
    expect(providerReleaseSurprisePolicy.reasonCode).toBe('provider-surprise-confirmed')
  })

  it('keeps a routine release out, whichever unit the value carries', () => {
    // 初请 199 vs 预期 200：相对偏离 0.5%，够不上 5%。
    expect(surprises([observation({ titleKey: '初请失业金人数', actual: { displayValue: '199' }, consensus: { displayValue: '200' } })])).toEqual([])
    // 同样的百分数口径下，0.1pp 的日常修订也不算意外。
    expect(surprises([observation({ actual: { displayValue: '4.5%' }, consensus: { displayValue: '4.4%' } })])).toEqual([])
  })

  it('reads the two unit classes with the contract threshold', () => {
    // 阈值只有一份，在契约模块；这里改一个常量，下面四条里必有一条变红。
    expect(marketCalendarSurprisePolicy.trigger).toEqual({ percentPoints: 0.2, relativeFraction: 0.05 })
    expect(surprises([observation({ actual: { displayValue: '4.61%' }, consensus: { displayValue: '4.4%' } })])).toHaveLength(1)
    expect(surprises([observation({ actual: { displayValue: '4.59%' }, consensus: { displayValue: '4.4%' } })])).toEqual([])
    // 裸数字按相对量：非农 25 万 vs 预期 18 万（相对 38.9%）算意外。
    expect(surprises([observation({ titleKey: '9月季调后非农就业人口变动(万人)', actual: { displayValue: '25.0' }, consensus: { displayValue: '18.0' } })])).toHaveLength(1)
    expect(surprises([observation({ actual: { displayValue: '158' }, consensus: { displayValue: '150' } })])).toHaveLength(1)
    expect(surprises([observation({ actual: { displayValue: '157' }, consensus: { displayValue: '150' } })])).toEqual([])
    // 预期为 0 时没有相对量可算 —— 不猜，按不算意外处理。
    expect(surprises([observation({ actual: { displayValue: '3' }, consensus: { displayValue: '0' } })])).toEqual([])
  })

  it('refuses to judge a value it cannot compare', () => {
    // 单位不同（一个带 %，一个不带）或缺失，都按"不可比"处理，与契约的 `assessMarketCalendarSurprise` 同一套规则。
    expect(surprises([observation({ consensus: { displayValue: '4.4' } })])).toEqual([])
    expect(surprises([observation({ actual: null })])).toEqual([])
    expect(surprises([observation({ consensus: null })])).toEqual([])
  })

  it('only bridges the releases the decision named: US, high importance, economic indicator', () => {
    const policy = providerReleaseSurprisePolicy
    expect([policy.qualifyingCountryCode, policy.qualifyingImportance, policy.qualifyingEventFamily]).toEqual(['US', 'high', 'economic-indicator'])
    expect(surprises([observation({ countryCode: 'DE' })])).toEqual([])
    expect(surprises([observation({ eventFamily: 'central-bank-activity' })])).toEqual([])
    // 口径要的是**高重要性**。这一条同时是已知的缺口：读者举的那批发布（核心 PPI、零售销售）在
    // provider 的 star 评级里是 medium，因此按当前口径不会进这条流。见设计 145 §10 的记档。
    expect(surprises([observation({ importance: 'medium' })])).toEqual([])
  })

  it('counts one release once: an actual the previous snapshot already carried is not news', () => {
    const previous = new Map([[providerSurpriseBaselineKey(observation()), '5.0%']])
    expect(surprises([observation()], previous)).toEqual([])
    // 值被修正（5.0% → 5.4%）才算这次才看到的。
    expect(surprises([observation({ actual: { displayValue: '5.4%' } })], previous)).toHaveLength(1)
  })

  it('treats an event the previous snapshot never carried as fresh only when it really arrived', () => {
    const unseen = new Map<string, string | null>()
    // 这次才检测到（detectedAt 晚于上一个快照）、且在发布后的一天内：算。
    expect(surprises([observation()], unseen)).toHaveLength(1)
    // 上个快照之后没有新检测到它，只是掉出了事实预算：不算，别把历史当成新闻重放。
    expect(surprises([observation({ detectedAt: '2026-10-15T11:00:00.000Z' })], unseen)).toEqual([])
    // 太旧：不重放。
    expect(surprises([observation({ scheduledAt: '2026-10-10T12:30:00.000Z' })], unseen)).toEqual([])
  })

  it('judges without a baseline rather than refusing to', () => {
    // 第一次分析（没有上一个快照）：实际值就是新的，按意外处理。
    expect(surprises([observation()], null, null)).toHaveLength(1)
    expect(providerReleaseSurprisePolicy.freshOnly).toBe(true)
  })
})
