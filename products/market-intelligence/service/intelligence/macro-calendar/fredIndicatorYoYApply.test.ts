import { describe, expect, it } from 'vitest'

import { applyOfficialYoY } from './fredIndicatorYoY'
import type { MacroIndicatorCardFact } from './macroIndicatorCardFacts'

/** 今天的真情形：本期 2026-10 结构性无值，FRED 最新观测是 2026-09。 */
const cpi: MacroIndicatorCardFact = {
  metricKey: 'US.CPI.NSA.YOY', state: 'missing-current', period: '2026-10',
  releasedAt: '2026-11-10T13:30:00.000Z', previousAsPublished: 3.7, unit: 'percent'
}

describe('applyOfficialYoY', () => {
  it('fills 上一期 from the official series when FRED\'s latest observation is the previous period', () => {
    const next = applyOfficialYoY(cpi, { state: 'ok', value: 3.73768, observedAt: '2026-09-01T00:00:00.000Z', seriesId: 'CPIAUCNS' })
    expect(next).toMatchObject({ state: 'missing-current', previousAsPublished: 3.73768, previousSource: 'fred', previousObservedAt: '2026-09-01T00:00:00.000Z' })
    // 主位仍是「本期无值」——官方也不可能给没有的分母算出值。
    expect(next.value).toBeUndefined()
  })

  it('uses the official value as the current value once its period matches the release period', () => {
    const next = applyOfficialYoY(cpi, { state: 'ok', value: 3.7, observedAt: '2026-10-01T00:00:00.000Z', seriesId: 'CPIAUCNS' })
    expect(next).toMatchObject({ state: 'provided', value: 3.7, source: 'fred' })
  })

  /**
   * 旧源正在删除：本期由官方给值以后，「上一期」必须也来自官方前一个观测，
   * 否则等旧源消失，那一格会在没人察觉的情况下变空。
   */
  it('takes 上一期 from the previous official observation, not from the old source', () => {
    const next = applyOfficialYoY(cpi, {
      state: 'ok', value: 3.8, observedAt: '2026-10-01T00:00:00.000Z', seriesId: 'CPIAUCNS',
      previous: { value: 3.73768, observedAt: '2026-09-01T00:00:00.000Z' }
    })
    expect(next).toMatchObject({
      value: 3.8, previousAsPublished: 3.73768, previousSource: 'fred',
      previousObservedAt: '2026-09-01T00:00:00.000Z'
    })
  })

  it('says 上一期 is unreadable when the official window has no previous observation', () => {
    const next = applyOfficialYoY(cpi, { state: 'ok', value: 3.8, observedAt: '2026-10-01T00:00:00.000Z', seriesId: 'CPIAUCNS' })
    expect(next.previousUnreadable).toBe(true)
  })

  /** 读不到不退回旧数字：旧源正在被删，它那份值会冻结在删除那一刻。 */
  it('marks 上一期 as unreadable instead of keeping the stale number', () => {
    const next = applyOfficialYoY(cpi, { state: 'unavailable', seriesId: 'CPIAUCNS', reason: 'read-failed' })
    expect(next.previousUnreadable).toBe(true)
  })

  it('leaves a card with no release row alone', () => {
    const pce: MacroIndicatorCardFact = { metricKey: 'US.CORE_PCE.SA.YOY', state: 'not-recorded' }
    expect(applyOfficialYoY(pce, { state: 'unavailable', seriesId: '', reason: 'no-series' })).toEqual(pce)
  })

  /**
   * `no-series` 是「这个指标没有官方序列」，不是「读不到」：非农的上期 29 来自日历库，
   * 官方那一腿不存在，不该被抹成「暂时读不到」。
   */
  it('does not mark 上一期 unreadable for a metric that has no official series', () => {
    const payrolls: MacroIndicatorCardFact = {
      metricKey: 'US.NONFARM.SA.CHANGE', state: 'provided', period: '2026-10',
      value: 165, previousAsPublished: 29, unit: 'thousands', source: 'narwhal'
    }
    expect(applyOfficialYoY(payrolls, { state: 'unavailable', seriesId: '', reason: 'no-series' })).toEqual(payrolls)
  })
})
