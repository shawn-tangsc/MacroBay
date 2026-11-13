import { describe, expect, it } from 'vitest'

import { sanitize } from './macroIndicatorClient'

/** 真实读数今天的样子（装配层读出来的四个指标）。 */
const payload = {
  state: 'available',
  asOf: '2026-11-13T10:00:00.000Z',
  facts: [
    { metricKey: 'US.CPI.NSA.YOY', state: 'missing-current', period: '2026-10', releasedAt: '2026-11-10T13:30:00.000Z', previousAsPublished: 3.7, unit: 'percent' },
    { metricKey: 'US.CORE_CPI.NSA.YOY', state: 'missing-current', period: '2026-10', releasedAt: '2026-11-10T13:30:00.000Z', previousAsPublished: 2.6, unit: 'percent' },
    { metricKey: 'US.NONFARM.SA.CHANGE', state: 'provided', period: '2026-10', releasedAt: '2026-11-06T13:30:00.000Z', value: 165, previousAsPublished: 29, unit: 'thousands', source: 'narwhal' },
    { metricKey: 'US.CORE_PCE.NSA.YOY', state: 'not-recorded' },
    { metricKey: 'US.UNEMPLOYMENT.SA.RATE', state: 'provided', period: '2026-10', releasedAt: '2026-11-06T13:30:00.000Z', value: 4.1, unit: 'percent', source: 'narwhal' }
  ]
}

describe('macroIndicatorClient.sanitize', () => {
  it('keeps the four facts a card can render', () => {
    const result = sanitize(payload)
    expect(result).toMatchObject({ state: 'available' })
    const facts = result.state === 'available' ? result.facts : []
    expect(facts).toHaveLength(5)
    expect(facts.find((fact) => fact.metricKey === 'US.NONFARM.SA.CHANGE')).toMatchObject({ value: 165, previousAsPublished: 29 })
  })

  /**
   * 半份事实比没有事实更容易被当成真读数：少一张卡就整份作废，不画「其余三张是真的」。
   */
  it('refuses a payload that lost one of the four cards', () => {
    expect(sanitize({ ...payload, facts: payload.facts.slice(0, 4) })).toMatchObject({ state: 'unavailable', failureCode: 'malformed' })
  })

  it('drops a card whose state is not one of the three, taking the whole payload with it', () => {
    const broken = { ...payload, facts: [{ ...payload.facts[3]!, state: 'unknown' }, ...payload.facts.slice(0, 4)] }
    expect(sanitize(broken)).toMatchObject({ state: 'unavailable' })
  })

  /** 窗口只拿事实：观测行身份（`marketFactKey`、源内 `measure` 名）不进渲染层。 */
  it('strips internal observation identity that slipped into a fact', () => {
    const leaky = { ...payload, facts: payload.facts.map((fact) => ({ ...fact, marketFactKey: '["0xrouter"]', measure: 'cpi_yoy' })) }
    const result = sanitize(leaky)
    const facts = result.state === 'available' ? result.facts : []
    expect(facts).toHaveLength(5)
    for (const fact of facts) {
      expect(fact).not.toHaveProperty('marketFactKey')
      expect(fact).not.toHaveProperty('measure')
    }
  })

  it('passes an unreadable answer through instead of inventing facts', () => {
    expect(sanitize({ state: 'unavailable', failureCode: 'unreadable' })).toEqual({ state: 'unavailable', failureCode: 'unreadable' })
    expect(sanitize(undefined)).toEqual({ state: 'unavailable', failureCode: 'malformed' })
  })
})
