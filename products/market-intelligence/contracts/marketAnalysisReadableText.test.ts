import { describe, expect, it } from 'vitest'

import {
  formatReadableAnalysisValue,
  formatReadableUsdAmount,
  isSignedAnalysisMetric,
  localizeAnalysisMagnitudeUnits,
  readableAnalysisFactValue,
  readableAnalysisName,
  toReadableConclusionText,
  type MarketAnalysisReadableNames
} from './marketAnalysisReadableText'

/** A vocabulary fixture: this contract test must not depend on product copy. */
const names: MarketAnalysisReadableNames = Object.freeze({
  domain: Object.freeze({ capital: '资金面', 'cross-asset': '跨资产' }),
  metric: Object.freeze({ 'current-usd': '当前值', 'change-1d-usd': '1 日变化', 'etf-net-flow-usd': 'ETF 净流入', 'event-name': '事件', 'lifecycle-state': '生命周期' }),
  subject: Object.freeze({ stablecoins: '稳定币', BTC: 'BTC' }),
  eventName: Object.freeze({ 'core-cpi': '核心 CPI' }),
  lifecycleState: Object.freeze({ released: '已公布' }),
  comparability: Object.freeze({ comparable: '可比' }),
  caveat: Object.freeze({ 'macro-calendar-consensus-unavailable': '缺少市场预期值' }),
  term: Object.freeze({ consensus: '市场预期值' })
})

describe('readable analysis text', () => {
  it('scales stored USD integers instead of printing them raw', () => {
    expect(formatReadableUsdAmount(258_458_629_557.07956, 'zh-CN', false)).toBe('2584.59 亿美元')
    expect(formatReadableUsdAmount(314_300_000, 'zh-CN')).toBe('+3.14 亿美元')
    expect(formatReadableUsdAmount(-13_425_507, 'zh-CN')).toBe('-1342.55 万美元')
    expect(formatReadableUsdAmount(314_300_000, 'en-US')).toBe('+$314.3M')
    expect(formatReadableUsdAmount(-4_483_000_000, 'en-US')).toBe('-$4.48B')
  })

  it('signs flows, leaves levels unsigned and shortens a long text value', () => {
    expect(isSignedAnalysisMetric('change-1d-usd')).toBe(true)
    expect(isSignedAnalysisMetric('current-usd')).toBe(false)
    expect(formatReadableAnalysisValue(-0.003657, 'percent')).toBe('-0.003657%')
    expect(formatReadableAnalysisValue(0.5, 'percent')).toBe('+0.5%')
    expect(formatReadableAnalysisValue(71, 'score')).toBe('71')
    expect(formatReadableAnalysisValue('x'.repeat(200), null)).toBe(`${'x'.repeat(72)}…`)
  })

  it('names a fact value from the injected vocabulary and falls back to the raw value', () => {
    expect(readableAnalysisFactValue(names, 'event-name', 'core-cpi', null)).toBe('核心 CPI')
    expect(readableAnalysisFactValue(names, 'lifecycle-state', 'released', null)).toBe('已公布')
    expect(readableAnalysisFactValue(names, 'event-name', 'brand-new-key', null)).toBe('brand-new-key')
    expect(readableAnalysisFactValue(names, 'change-1d-usd', -406_814_368, 'USD')).toBe('-4.07 亿美元')
    expect(readableAnalysisFactValue(names, 'current-usd', null, 'USD')).toBeNull()
  })

  it('falls back to the identifier so an unnamed field stays visible', () => {
    expect(readableAnalysisName(names, 'metric', 'some-new-metric')).toBe('some-new-metric')
    expect(readableAnalysisName(names, 'metric', null)).toBeNull()
    expect(readableAnalysisName(names, 'domain', '')).toBeNull()
  })

  it('names every registered identifier a published conclusion may quote', () => {
    const reported = '稳定币current-usd降了；change-1d-usd收窄；缺少 cross-asset 证据；consensus 缺失；'
      + 'macro-calendar-consensus-unavailable 已记录；但 some-new-metric 与 score、all 保持原样。'
    const readable = toReadableConclusionText(reported, names)

    expect(readable).toContain('稳定币当前值降了')
    expect(readable).toContain('1 日变化收窄')
    expect(readable).toContain('缺少 跨资产 证据')
    expect(readable).toContain('市场预期值 缺失')
    expect(readable).toContain('缺少市场预期值 已记录')
    expect(readable).toContain('some-new-metric 与 score、all 保持原样')
  })

  it('never rewrites a registered name inside a longer token', () => {
    expect(toReadableConclusionText('xchange-1d-usdx', names)).toBe('xchange-1d-usdx')
    expect(toReadableConclusionText('change-1d-usd-extra', names)).toBe('change-1d-usd-extra')
    expect(toReadableConclusionText('stablecoinsx', names)).toBe('stablecoinsx')
  })

  it('abbreviates a raw quantity so a reader gets the magnitude, not every digit', () => {
    const text = '稳定币current-usd由257,970,817,433.68085降至257,938,932,953.4702；'
      + 'change-1d-usd由-406,814,368.04333496变为-439,273,208.6280823。'
    const readable = toReadableConclusionText(text, names)

    expect(readable).toContain('稳定币当前值由2579.71 亿降至2579.39 亿')
    expect(readable).toContain('1 日变化由-4.07 亿变为-4.39 亿')
    expect(readable).not.toMatch(/257,970,817,433|406,814,368|04333496/)
  })

  it('leaves a year, a date, a percentage, a small count and an abbreviation alone', () => {
    const text = '2026-10-07 的 3.2%、+29K、71、0.000992% 与 10-06 的 1.188 亿都保持原样。'
    expect(toReadableConclusionText(text, names)).toBe(text)
  })

  it('abbreviates in the locale it is given', () => {
    expect(toReadableConclusionText('314,300,000 USD', names, 'en-US')).toBe('314.3 M USD')
    expect(toReadableConclusionText('314,300,000 美元', names, 'zh-CN')).toBe('3.14 亿 美元')
  })

  it('rewrites Chinese magnitude units for an English reader without touching Chinese text', () => {
    const english = 'Stablecoins fell 44.83 亿美元 over 30 days and BTC ETFs saw a −6.36亿美元 outflow.'
    expect(localizeAnalysisMagnitudeUnits(english, 'en-US'))
      .toBe('Stablecoins fell $4.48B over 30 days and BTC ETFs saw a -$636M outflow.')
    expect(localizeAnalysisMagnitudeUnits('手续费 1.2 万美元', 'en-US')).toBe('手续费 $12K')
    // The Chinese reading is already correct and must stay byte-for-byte identical.
    expect(localizeAnalysisMagnitudeUnits('净流出 −6.36亿美元', 'zh-CN')).toBe('净流出 −6.36亿美元')
  })
})
