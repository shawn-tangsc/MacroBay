import { describe, expect, it } from 'vitest'

import type { CrossAssetMetric } from '../../../../contracts/crossAssetObservationContracts'
import { crossAssetCurveStrideMs, crossAssetWindowReturns, crossAssetWindows } from './crossAssetWindowReturns'

const percentPerPoint = (points: number, step = 0.1): { returnPercent: number }[] =>
  Array.from({ length: points }, (_, index) => ({ returnPercent: index * step }))
const available = (value: number): CrossAssetMetric => ({ state: 'available', value })
const unavailable: CrossAssetMetric = { state: 'unavailable', reason: 'insufficient' }
const closed24h = { '1h': available(1.23), '24h': available(-2.5) }
function expectPercent(metric: CrossAssetMetric | undefined, expected: number): void {
  expect(metric?.state).toBe('available')
  expect(metric && metric.state === 'available' ? metric.value : Number.NaN).toBeCloseTo(expected, 5)
}

describe('cross-asset window returns', () => {
  it('shows exactly the 15m/1h/24h/7d ladder the table renders', () => {
    expect([...crossAssetWindows]).toEqual(['15m', '1h', '24h', '7d'])
    expect(crossAssetCurveStrideMs['24h']).toBe(300_000)
    // The 7d curve is thinned to one point an hour; "48 points" there would be forty-eight hours.
    expect(crossAssetCurveStrideMs['7d']).toBe(3_600_000)
  })

  it('derives 15m from three 5m points and prefers an admitted closed return for the rest', () => {
    const result = crossAssetWindowReturns({ range: '24h', curves: percentPerPoint(289), closedReturns: closed24h })
    expectPercent(result['15m'], 0.2334630)
    // 1h and 24h prefer the admitted closed returns.
    expect(result['1h']).toEqual(available(1.23))
    expect(result['24h']).toEqual(available(-2.5))
    // A 24h curve is 289 five-minute points: 48 of them is four hours, not seven days. The column is
    // 无数据 here rather than a four-hour move wearing a 7d label.
    expect(result['7d']).toEqual({ state: 'unavailable', reason: 'insufficient' })
  })

  it('reports a window with too few curve points as no data, never as zero', () => {
    const result = crossAssetWindowReturns({ range: '24h', curves: percentPerPoint(10), closedReturns: { '1h': unavailable, '24h': available(-2.5) } })
    expectPercent(result['15m'], 0.2982107)
    expect(result['7d']).toEqual({ state: 'unavailable', reason: 'insufficient' })
    expect(result['1h']).toEqual({ state: 'unavailable', reason: 'insufficient' })
    expect(result['24h']).toEqual(available(-2.5))
    // The guard the whole module exists for: an unanswerable window is a state, not a figure.
    for (const window of crossAssetWindows) {
      const metric = result[window]
      expect(metric.state === 'unavailable' || Number.isFinite(metric.value)).toBe(true)
      if (metric.state === 'unavailable') expect(metric).not.toHaveProperty('value')
    }
  })

  it('answers 7d from the hourly 7d curve, and pays for it with no 15m reading there', () => {
    const result = crossAssetWindowReturns({ range: '7d', curves: percentPerPoint(169), closedReturns: closed24h })
    // The hourly curve cannot express a fifteen-minute move.
    expect(result['15m']).toEqual({ state: 'unavailable', reason: 'insufficient' })
    // 169 hourly points is one point per hour across seven days: the 7d window reaches the anchor.
    expectPercent(result['7d'], 16.8)
    expect(result['1h']).toEqual(available(1.23))
    expect(result['24h']).toEqual(available(-2.5))
  })

  it('falls back to the curve for 1h and 24h when the closed return is unavailable', () => {
    const result = crossAssetWindowReturns({ range: '24h', curves: percentPerPoint(289), closedReturns: { '1h': unavailable, '24h': unavailable } })
    expectPercent(result['1h'], 0.9404388)
    // The oldest curve point is the window anchor, so the 24h fallback is the newest anchored return.
    expectPercent(result['24h'], 28.8)
  })

  it('leaves a window open when the curve endpoint is a hole', () => {
    const newestNull = crossAssetWindowReturns({ range: '24h', curves: [{ returnPercent: 0 }, { returnPercent: 0.1 }, { returnPercent: null }], closedReturns: {} })
    expect(newestNull['15m']).toEqual({ state: 'unavailable', reason: 'missing' })
    const olderNull = crossAssetWindowReturns({ range: '24h', curves: [{ returnPercent: 0 }, { returnPercent: null }, { returnPercent: 0.2 }, { returnPercent: 0.3 }, { returnPercent: 0.4 }], closedReturns: {} })
    expect(olderNull['15m']).toEqual({ state: 'unavailable', reason: 'insufficient' })
    const empty = crossAssetWindowReturns({ range: '24h', curves: [], closedReturns: {} })
    expect(empty['15m']).toEqual({ state: 'unavailable', reason: 'missing' })
    for (const window of crossAssetWindows) expect(empty[window].state).toBe('unavailable')
  })
})
