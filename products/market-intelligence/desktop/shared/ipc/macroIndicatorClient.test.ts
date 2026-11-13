import { describe, expect, it } from 'vitest'

import { sanitize } from './macroIndicatorClient'

/**
 * 真实读数今天的样子：**12 个一级码**（2026-11-14 定稿，三张卡各 4 行）。
 * 少一个码整份作废——半份事实比没有事实更容易被当成真读数。
 */
const payload = {
  state: 'available',
  asOf: '2026-11-13T10:00:00.000Z',
  facts: [
    { metricKey: 'US.CPI.NSA.YOY', state: 'missing-current', period: '2026-10', releasedAt: '2026-11-10T13:30:00.000Z', previousAsPublished: 3.7, unit: 'percent' },
    { metricKey: 'US.CPI.SA.MOM', state: 'provided', period: '2026-10', releasedAt: '2026-11-10T13:30:00.000Z', value: 0.3, previousAsPublished: 0.2, unit: 'percent' },
    { metricKey: 'US.CORE_CPI.NSA.YOY', state: 'missing-current', period: '2026-10', releasedAt: '2026-11-10T13:30:00.000Z', previousAsPublished: 2.6, unit: 'percent' },
    { metricKey: 'US.CORE_CPI.SA.MOM', state: 'provided', period: '2026-10', releasedAt: '2026-11-10T13:30:00.000Z', value: 0.2, unit: 'percent' },
    { metricKey: 'US.NONFARM.SA.CHANGE', state: 'provided', period: '2026-10', releasedAt: '2026-11-06T13:30:00.000Z', value: 165, previousAsPublished: 29, unit: 'thousands', source: 'narwhal' },
    { metricKey: 'US.UNEMPLOYMENT.SA.RATE', state: 'provided', period: '2026-10', releasedAt: '2026-11-06T13:30:00.000Z', value: 4.1, unit: 'percent', source: 'narwhal' },
    { metricKey: 'US.AHE.SA.MOM', state: 'provided', period: '2026-10', releasedAt: '2026-11-06T13:30:00.000Z', value: 0.4, unit: 'percent', source: 'narwhal' },
    { metricKey: 'US.AHE.NSA.YOY', state: 'provided', period: '2026-10', releasedAt: '2026-11-06T13:30:00.000Z', value: 3.6, unit: 'percent', source: 'narwhal' },
    { metricKey: 'US.PCE.NSA.YOY', state: 'provided', period: '2026-09', releasedAt: '2026-09-26T13:30:00.000Z', value: 2.8, unit: 'percent', source: 'fred' },
    { metricKey: 'US.PCE.SA.MOM', state: 'provided', period: '2026-09', releasedAt: '2026-09-26T13:30:00.000Z', value: 0.2, unit: 'percent', source: 'fred' },
    { metricKey: 'US.CORE_PCE.NSA.YOY', state: 'provided', period: '2026-09', releasedAt: '2026-09-26T13:30:00.000Z', value: 3.1, unit: 'percent', source: 'fred' },
    { metricKey: 'US.CORE_PCE.SA.MOM', state: 'provided', period: '2026-09', releasedAt: '2026-09-26T13:30:00.000Z', value: 0.2, unit: 'percent', source: 'fred' }
  ]
}

describe('macroIndicatorClient.sanitize', () => {
  it('keeps the twelve facts the three cards can render', () => {
    const result = sanitize(payload)
    expect(result).toMatchObject({ state: 'available' })
    const facts = result.state === 'available' ? result.facts : []
    expect(facts).toHaveLength(12)
    expect(facts.find((fact) => fact.metricKey === 'US.NONFARM.SA.CHANGE')).toMatchObject({ value: 165, previousAsPublished: 29 })
  })

  /**
   * 半份事实比没有事实更容易被当成真读数：少一张卡就整份作废，不画「其余三张是真的」。
   */
  it('refuses a payload that lost one of the four cards', () => {
    expect(sanitize({ ...payload, facts: payload.facts.slice(0, 11) })).toMatchObject({ state: 'unavailable', failureCode: 'malformed' })
  })

  it('drops a card whose state is not one of the three, taking the whole payload with it', () => {
    const broken = { ...payload, facts: [{ ...payload.facts[0]!, state: 'unknown' }, ...payload.facts.slice(1)] }
    expect(sanitize(broken)).toMatchObject({ state: 'unavailable' })
  })

  /** 窗口只拿事实：观测行身份（`marketFactKey`、源内 `measure` 名）不进渲染层。 */
  it('strips internal observation identity that slipped into a fact', () => {
    const leaky = { ...payload, facts: payload.facts.map((fact) => ({ ...fact, marketFactKey: '["0xrouter"]', measure: 'cpi_yoy' })) }
    const result = sanitize(leaky)
    const facts = result.state === 'available' ? result.facts : []
    expect(facts).toHaveLength(12)
    for (const fact of facts) {
      expect(fact).not.toHaveProperty('marketFactKey')
      expect(fact).not.toHaveProperty('measure')
    }
  })

  /**
   * 白名单漏一个字段，界面上就只剩裸数字：上一期是官方序列还是日历库的首发布值、
   * 什么时候观测的，读者都看不出来。这条用例就是在守那份白名单别再漏。
   */
  it('keeps where the previous value came from, not just the number', () => {
    const withProvenance = {
      ...payload,
      facts: payload.facts.map((fact) => fact.metricKey === 'US.CPI.NSA.YOY'
        ? { ...fact, previousAsPublished: 3.73768, previousSource: 'fred', previousObservedAt: '2026-09-01T00:00:00.000Z' }
        : fact)
    }
    const cpi = (sanitize(withProvenance) as { facts: readonly Record<string, unknown>[] }).facts
      .find((fact) => fact.metricKey === 'US.CPI.NSA.YOY')!
    expect(cpi).toMatchObject({ previousSource: 'fred', previousObservedAt: '2026-09-01T00:00:00.000Z' })
  })

  it('keeps the next release, its expectation and that expectation\'s provenance', () => {
    const withNext = {
      ...payload,
      facts: payload.facts.map((fact) => fact.metricKey === 'US.NONFARM.SA.CHANGE'
        ? {
          ...fact,
          next: {
            period: '2026-11', releaseAt: '2026-12-04T13:30:00.000Z', timePrecision: 'minute',
            expected: { value: 112.5, provenance: 'market-implied', asOf: '2026-11-13T20:40:00.000Z', marketVolume: 5285 }
          }
        }
        : fact)
    }
    const payrolls = (sanitize(withNext) as { facts: readonly Record<string, unknown>[] }).facts
      .find((fact) => fact.metricKey === 'US.NONFARM.SA.CHANGE')!
    expect(payrolls.next).toEqual({
      period: '2026-11', releaseAt: '2026-12-04T13:30:00.000Z', timePrecision: 'minute',
      expected: { value: 112.5, provenance: 'market-implied', asOf: '2026-11-13T20:40:00.000Z', marketVolume: 5285 }
    })
  })

  /** 判红：预期有值却不带来源 → 这一格按「没有值」处理，不补一个来源上去。 */
  it('throws away an expectation whose provenance it cannot read', () => {
    const sourceless = {
      ...payload,
      facts: payload.facts.map((fact) => fact.metricKey === 'US.NONFARM.SA.CHANGE'
        ? { ...fact, next: { period: '2026-11', releaseAt: '2026-12-04T13:30:00.000Z', expected: { value: 112.5, asOf: '2026-11-13T20:40:00.000Z' } } }
        : fact)
    }
    const payrolls = (sanitize(sourceless) as { facts: readonly Record<string, unknown>[] }).facts
      .find((fact) => fact.metricKey === 'US.NONFARM.SA.CHANGE')!
    expect(payrolls.next).toEqual({ period: '2026-11', releaseAt: '2026-12-04T13:30:00.000Z' })
  })

  /** 盘口自称有值却不带成交量 → 无法验证，同样按「没有值」处理。 */
  it('refuses a market expectation that carries no volume', () => {
    const noVolume = {
      ...payload,
      facts: payload.facts.map((fact) => fact.metricKey === 'US.NONFARM.SA.CHANGE'
        ? { ...fact, next: { period: '2026-11', releaseAt: '2026-12-04T13:30:00.000Z',
          expected: { value: 112.5, provenance: 'market-implied', asOf: '2026-11-13T20:40:00.000Z' } } }
        : fact)
    }
    const payrolls = (sanitize(noVolume) as { facts: readonly Record<string, unknown>[] }).facts
      .find((fact) => fact.metricKey === 'US.NONFARM.SA.CHANGE')!
    expect(payrolls.next).not.toHaveProperty('expected')
  })

  it('passes an unreadable answer through instead of inventing facts', () => {
    expect(sanitize({ state: 'unavailable', failureCode: 'unreadable' })).toEqual({ state: 'unavailable', failureCode: 'unreadable' })
    expect(sanitize(undefined)).toEqual({ state: 'unavailable', failureCode: 'malformed' })
  })
})
