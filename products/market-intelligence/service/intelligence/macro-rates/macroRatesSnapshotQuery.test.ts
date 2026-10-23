import { describe, expect, it, vi } from 'vitest'

import { createMacroRatesSnapshotQuery } from './macroRatesSnapshotQuery'
import type { MetricIntelligenceEvent } from '../schema/intelligenceMetricEvent'

const now = Date.parse('2026-10-14T12:00:00.000Z')

/** One stored metric event, exactly the shape the metric pipeline writes. */
function event(overrides: Partial<MetricIntelligenceEvent> = {}): MetricIntelligenceEvent {
  return {
    metricEventId: 'metric-1', itemId: 'item-1', sourceId: 'fred-rates-liquidity',
    metricKey: 'US_10Y_YIELD', metricName: 'US 10Y Treasury Yield', metricKind: 'treasury-yield',
    actual: 5.24, previous: 5.22, unit: 'percent', period: '2026-10-09',
    releaseTime: '2026-10-09T00:00:00.000Z', comparisonBasis: 'period-change',
    surpriseDirection: 'up', metricVersion: 'metric-rest-api-v1', ...overrides
  }
}

function query(metrics: MetricIntelligenceEvent[]) {
  return createMacroRatesSnapshotQuery({ listMetricEvents: () => metrics, now: () => now })
}

describe('macro rates snapshot query', () => {
  it('answers the admitted rate series with its level, prior trading day and observation date', () => {
    const snapshot = query([
      event(),
      event({ metricEventId: 'metric-2', metricKey: 'US_REAL_YIELD_10Y', metricName: 'US 10Y Real Yield', actual: 2.91, previous: 2.87 }),
      event({ metricEventId: 'metric-3', metricKey: 'US_2Y_YIELD', metricName: 'US 2Y Treasury Yield', actual: 4.8, previous: 4.72 })
    ]).snapshot()

    expect(snapshot.state).toBe('available')
    expect(snapshot.asOf).toBe('2026-10-14T12:00:00.000Z')
    expect(snapshot.caveats).toEqual(['official-daily-close'])
    expect(snapshot.readings).toEqual([
      { seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 5.24, previous: 5.22, period: '2026-10-09' },
      { seriesId: 'DFII10', metricKey: 'US_REAL_YIELD_10Y', actual: 2.91, previous: 2.87, period: '2026-10-09' },
      { seriesId: 'DGS2', metricKey: 'US_2Y_YIELD', actual: 4.8, previous: 4.72, period: '2026-10-09' }
    ])
  })

  it('keeps the newest stored observation of a series, not the order the store returned', () => {
    const snapshot = query([
      event({ metricEventId: 'old', actual: 5.28, previous: 5.3, period: '2026-10-07', releaseTime: '2026-10-07T00:00:00.000Z' }),
      event({ metricEventId: 'new', actual: 5.24, previous: 5.22, period: '2026-10-09', releaseTime: '2026-10-09T00:00:00.000Z' })
    ]).snapshot()

    expect(snapshot.readings).toHaveLength(1)
    expect(snapshot.readings[0]).toMatchObject({ actual: 5.24, previous: 5.22, period: '2026-10-09' })
  })

  it('drops an observation that was not yet visible at the read instant', () => {
    const snapshot = query([
      event({ metricEventId: 'future', actual: 9.99, period: '2026-10-20', releaseTime: '2026-10-20T00:00:00.000Z' })
    ]).snapshot()

    expect(snapshot.state).toBe('empty')
    expect(snapshot.readings).toEqual([])
    expect(JSON.stringify(snapshot)).not.toContain('9.99')
  })

  it('ignores every series this boundary does not admit', () => {
    const snapshot = query([
      event({ metricKey: 'DXY_PROXY', actual: 121.5 }),
      event({ metricKey: 'FED_BALANCE_SHEET', actual: 6_500_000 })
    ]).snapshot()

    expect(snapshot).toMatchObject({ state: 'empty', readings: [] })
  })

  it('ignores a metric event another source wrote', () => {
    const snapshot = query([event({ sourceId: 'bls-economic-series' })]).snapshot()
    expect(snapshot.state).toBe('empty')
  })

  it.each([
    ['a non-finite level', { actual: Number.NaN }],
    ['a level beyond any yield', { actual: 1_000 }],
    ['a period that is not a trading date', { period: '2026/10/09' }],
    ['a missing period', { period: undefined }],
    ['a release time that is not an instant', { releaseTime: '2026-10-09' }]
  ])('drops %s rather than printing it', (_name, overrides) => {
    const snapshot = query([event(overrides)]).snapshot()

    expect(snapshot.state).toBe('empty')
    expect(snapshot.readings).toEqual([])
  })

  it('drops a series whose newest observation disagrees with itself', () => {
    const snapshot = query([
      event({ metricEventId: 'a', actual: 5.24 }),
      event({ metricEventId: 'b', actual: 5.19 })
    ]).snapshot()

    expect(snapshot).toMatchObject({ state: 'empty', readings: [] })
  })

  it('answers unavailable instead of empty when the store itself fails', () => {
    const failing = createMacroRatesSnapshotQuery({
      listMetricEvents: () => { throw new Error('store-unavailable') },
      now: () => now
    })

    expect(failing.snapshot()).toEqual({ state: 'unavailable' })
  })

  it('does not carry a source key, url or credential into the reading', () => {
    const snapshot = query([event({ rawValueJson: JSON.stringify({ seriesId: 'DGS10' }) })]).snapshot()
    expect(JSON.stringify(snapshot)).not.toMatch(/api_key|https?:|observations/i)
  })

  it('reads the store on every call, so a later collection is visible without a restart', () => {
    const listMetricEvents = vi.fn(() => [event()])
    const live = createMacroRatesSnapshotQuery({ listMetricEvents, now: () => now })

    live.snapshot()
    live.snapshot()

    expect(listMetricEvents).toHaveBeenCalledTimes(2)
  })
})
