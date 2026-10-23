import { expect, it } from 'vitest'

import { crossAssetAnalyticsPolicy, crossAssetObservationPolicy } from '../cross-asset/crossAssetAnalytics'
import { barRetentionPolicy } from '../retention/barRetention'
import { explainFigure } from './traceabilityExplain'

/**
 * `explainFigure` 的内核（设计 144 §4.2/§5）。
 *
 * 它要能被 agent 拿去原原本本回答"这个数从哪来、怎么算的"，所以这里钉的是**数字的出处**（回答时从 owner
 * 现读）、**说不出来时的诚实**（别侧的族 / 不认识的族都明说），以及节律也走引用这一条。
 */
it('explains a family it owns with the numbers read from their owners', () => {
  const answer = explainFigure('cross-market-reading')
  expect(answer.state).toBe('available')
  if (answer.state !== 'available') return
  expect(answer.nameKey).toBe('provenance.cross-market-reading.title')
  expect(answer.source.providerIds.length).toBeGreaterThan(0)
  // 四条腿的界线、√24 的窗口缩放、ρ 的周期与样本下限都在回答里，而且等于 owner 此刻的值。
  expect(answer.values['flat-band.dxy']).toBe(crossAssetObservationPolicy.flatPercent.dxy)
  expect(answer.values['flat-band.btc']).toBe(crossAssetObservationPolicy.flatPercent.btc)
  expect(Number(answer.values['band.window-scale-24h'])).toBeCloseTo(Math.sqrt(24), 10)
  expect(answer.values['reading.window']).toBe('24h')
  expect(answer.values['correlation.interval']).toBe('5m')
  expect(answer.formula.functionRefs).toContain('resolveCrossAssetReading')
  expect(answer.cadence).toEqual({ kind: 'bar', intervalMs: 300_000 })
})

it('reads the sampling family\'s retention tiers from the retention policy', () => {
  const answer = explainFigure('chart-sampling')
  expect(answer.state).toBe('available')
  if (answer.state !== 'available') return
  expect(answer.values['retention.hot-ms']).toBe(barRetentionPolicy.hotMs)
  // 准入窗口都在 8 天热层内：被稀释与携带受限对已交付的图表不可达，所以这一族只剩「没有锚点」一种降级。
  expect(answer.degradations).toEqual(['no-anchor'])
})

it('says "not on this side" for the family the renderer owns, instead of inventing one', () => {
  const answer = explainFigure('daily-rate-row')
  expect(answer).toEqual({ state: 'unavailable', family: 'daily-rate-row', reason: 'not-on-this-side', ownedHere: ['cross-market-reading', 'chart-sampling'] })
})

it('says "no record" for a family nobody has, and never guesses', () => {
  const answer = explainFigure('moon-phase')
  expect(answer.state).toBe('unavailable')
  expect(answer.state === 'unavailable' && answer.reason).toBe('unknown-family')
})
