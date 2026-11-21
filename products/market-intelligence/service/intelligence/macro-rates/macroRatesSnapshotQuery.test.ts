import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMacroRatesSnapshotQuery } from './macroRatesSnapshotQuery'
import type { MacroRatesSnapshot } from './macroRatesSnapshotQuery'
import { macroRatesSnapshotPublicPolicy } from '../../../contracts/macro/macroRatesSnapshotContracts'
import { createMacroMarketStore, type MacroMarketStore } from '../macro-market/macroMarketStore'
import type { MetricIntelligenceEvent } from '../schema/intelligenceMetricEvent'

const now = Date.parse('2026-10-14T12:00:00.000Z')
const day = 86_400_000
const at = (date: string) => Date.parse(`${date}T00:00:00.000Z`)

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function openStore(): MacroMarketStore {
  const directory = mkdtempSync(join(tmpdir(), 'macro-rates-query-')); directories.push(directory)
  return createMacroMarketStore(join(directory, 'macro-market.sqlite'))
}

/** Stored daily closes for one instrument: `[date, level]` pairs, written the way the collector writes them. */
function storeSeries(store: MacroMarketStore, series: string, rows: readonly (readonly [string, number])[]): void {
  store.append(rows.map(([date, value]) => ({ series, atMs: at(date), value, observedAtMs: now })))
}

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

function query(metrics: MetricIntelligenceEvent[], store?: MacroMarketStore) {
  return createMacroRatesSnapshotQuery({
    ...(store === undefined ? {} : { store }),
    listMetricEvents: () => metrics,
    now: () => now
  })
}

/**
 * The published half of the union. Reading a figure without saying what happens on `unavailable`
 * is the narrowing this union exists to force, so each test states it here instead of casting.
 */
function published(snapshot: MacroRatesSnapshot) {
  if (snapshot.state === 'unavailable') throw new Error('expected a published rates snapshot, got unavailable')
  return snapshot
}

describe('macro rates snapshot query', () => {
  it('answers each series with the window the store holds, newest last', () => {
    const store = openStore()
    storeSeries(store, macroRatesSnapshotPublicPolicy.series.us10y, [['2026-10-08', 5.22], ['2026-10-09', 5.24]])
    const snapshot = published(query([], store).snapshot())

    expect(snapshot.state).toBe('available')
    expect(snapshot.readings).toEqual([{
      seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 5.24, previous: 5.22, period: '2026-10-09',
      window: [{ period: '2026-10-08', value: 5.22 }, { period: '2026-10-09', value: 5.24 }]
    }])
    store.close()
  })

  it('states a spread only on the days both legs share', () => {
    const store = openStore()
    const series = macroRatesSnapshotPublicPolicy.series
    storeSeries(store, series.us10y, [['2026-10-08', 5.22], ['2026-10-09', 5.24]])
    // 2 年期只有 10-09：10-08 那天没有共同收盘，就不该有那一天的价差点。
    storeSeries(store, series.us2y, [['2026-10-09', 4.8]])
    storeSeries(store, series.us3m, [['2026-10-09', 4.6]])
    const snapshot = published(query([], store).snapshot())

    const us2y = snapshot.readings.find((reading) => reading.seriesId === series.us2y)
    // 窗口只有一个点时，前一日就是未知——不是 0，也不是 4.8。
    expect(us2y).toEqual({
      seriesId: 'DGS2', metricKey: 'US_2Y_YIELD', actual: 4.8, period: '2026-10-09',
      window: [{ period: '2026-10-09', value: 4.8 }]
    })
    expect(snapshot.spreads).toEqual([
      {
        key: 'us10y-minus-us2y', actual: 0.44, period: '2026-10-09',
        window: [{ period: '2026-10-09', value: 0.44 }]
      },
      {
        key: 'us10y-minus-us3m', actual: 0.64, period: '2026-10-09',
        window: [{ period: '2026-10-09', value: 0.64 }]
      }
    ])
    store.close()
  })

  it('carries the spread window day by day, with a previous value when both days are shared', () => {
    const store = openStore()
    const series = macroRatesSnapshotPublicPolicy.series
    storeSeries(store, series.us10y, [['2026-10-08', 5.22], ['2026-10-09', 5.24]])
    storeSeries(store, series.us2y, [['2026-10-08', 4.9], ['2026-10-09', 4.8]])
    const snapshot = published(query([], store).snapshot())

    const spread = snapshot.spreads.find((candidate) => candidate.key === 'us10y-minus-us2y')
    expect(spread).toEqual({
      key: 'us10y-minus-us2y', actual: 0.44, previous: 0.32, period: '2026-10-09',
      window: [{ period: '2026-10-08', value: 0.32 }, { period: '2026-10-09', value: 0.44 }]
    })
    store.close()
  })

  it('does not state a spread whose short leg is missing', () => {
    const store = openStore()
    storeSeries(store, macroRatesSnapshotPublicPolicy.series.us10y, [['2026-10-09', 5.24]])
    const snapshot = published(query([], store).snapshot())

    expect(snapshot.readings).toHaveLength(1)
    // 「拿不到」不是 0：没有短端就没有价差，绝不印一个 5.24。
    expect(snapshot.spreads).toEqual([])
    store.close()
  })

  it('keeps a day with no observation as a gap in the window, never as a zero', () => {
    const store = openStore()
    storeSeries(store, macroRatesSnapshotPublicPolicy.series.us10y, [['2026-10-07', 5.28], ['2026-10-09', 5.24]])
    const snapshot = published(query([], store).snapshot())

    expect(snapshot.readings[0]?.window).toEqual([
      { period: '2026-10-07', value: 5.28 }, { period: '2026-10-09', value: 5.24 }
    ])
    expect(snapshot.readings[0]?.previous).toBe(5.28)
    expect(snapshot.readings[0]?.window.some((point) => point.value === 0)).toBe(false)
    store.close()
  })

  it('caps the window at the policy length, keeping the newest trading days', () => {
    const store = openStore()
    const length = macroRatesSnapshotPublicPolicy.windowPoints + 20
    storeSeries(store, macroRatesSnapshotPublicPolicy.series.us10y,
      Array.from({ length }, (_, index) => [new Date(Date.UTC(2025, 0, 1) + index * day).toISOString().slice(0, 10), 4 + index / 1_000] as const))
    const snapshot = published(query([], store).snapshot())

    const window = snapshot.readings[0]?.window ?? []
    expect(window).toHaveLength(macroRatesSnapshotPublicPolicy.windowPoints)
    expect(window.at(-1)?.period).toBe(new Date(Date.UTC(2025, 0, 1) + (length - 1) * day).toISOString().slice(0, 10))
    store.close()
  })

  it('answers the admitted rate series with its level, prior trading day and observation date', () => {
    const snapshot = published(query([
      event(),
      event({ metricEventId: 'metric-2', metricKey: 'US_REAL_YIELD_10Y', metricName: 'US 10Y Real Yield', actual: 2.91, previous: 2.87 }),
      event({ metricEventId: 'metric-3', metricKey: 'US_2Y_YIELD', metricName: 'US 2Y Treasury Yield', actual: 4.8, previous: 4.72 })
    ]).snapshot())

    expect(snapshot.state).toBe('available')
    expect(snapshot.asOf).toBe('2026-10-14T12:00:00.000Z')
    expect(snapshot.caveats).toEqual(['official-daily-close'])
    // 顺序是曲线读的顺序：期限在前（3M → 30Y），非期限的两个跟在后面。
    expect(snapshot.readings).toEqual([
      {
        seriesId: 'DGS2', metricKey: 'US_2Y_YIELD', actual: 4.8, previous: 4.72, period: '2026-10-09',
        window: [{ period: '2026-10-09', value: 4.8 }]
      },
      {
        seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 5.24, previous: 5.22, period: '2026-10-09',
        window: [{ period: '2026-10-09', value: 5.24 }]
      },
      {
        seriesId: 'DFII10', metricKey: 'US_REAL_YIELD_10Y', actual: 2.91, previous: 2.87, period: '2026-10-09',
        window: [{ period: '2026-10-09', value: 2.91 }]
      }
    ])
    // 两条腿都只有同一天时，价差也就只有那一天——不拿另一天的值凑。
    expect(snapshot.spreads.map((spread) => [spread.key, spread.actual, spread.window.length])).toEqual([
      ['us10y-minus-us2y', 0.44, 1]
    ])
  })

  it('falls back to the newest metric event while the store holds no series yet', () => {
    const store = openStore()
    const snapshot = published(query([event()], store).snapshot())

    // 迁移期兜底：库里还没有这条序列时给单日读数，窗口只有这一天——读者能看出「还没有走势」。
    expect(snapshot.readings).toEqual([{
      seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 5.24, previous: 5.22, period: '2026-10-09',
      window: [{ period: '2026-10-09', value: 5.24 }]
    }])
    expect(snapshot.spreads).toEqual([])
    store.close()
  })

  it('prefers the stored window over the single-day event for the same series', () => {
    const store = openStore()
    storeSeries(store, macroRatesSnapshotPublicPolicy.series.us10y, [['2026-10-08', 5.22], ['2026-10-09', 5.24]])
    const snapshot = published(query([event({ actual: 5.3 })], store).snapshot())

    expect(snapshot.readings).toHaveLength(1)
    expect(snapshot.readings[0]).toMatchObject({ actual: 5.24, period: '2026-10-09' })
    expect(snapshot.readings[0]?.window).toHaveLength(2)
    store.close()
  })

  it('keeps the newest stored observation of a series, not the order the store returned', () => {
    const snapshot = published(query([
      event({ metricEventId: 'old', actual: 5.28, previous: 5.3, period: '2026-10-07', releaseTime: '2026-10-07T00:00:00.000Z' }),
      event({ metricEventId: 'new', actual: 5.24, previous: 5.22, period: '2026-10-09', releaseTime: '2026-10-09T00:00:00.000Z' })
    ]).snapshot())

    expect(snapshot.readings).toHaveLength(1)
    expect(snapshot.readings[0]).toMatchObject({ actual: 5.24, previous: 5.22, period: '2026-10-09' })
  })

  it('drops an observation that was not yet visible at the read instant', () => {
    const snapshot = published(query([
      event({ metricEventId: 'future', actual: 9.99, period: '2026-10-20', releaseTime: '2026-10-20T00:00:00.000Z' })
    ]).snapshot())

    expect(snapshot.state).toBe('empty')
    expect(snapshot.readings).toEqual([])
    expect(snapshot.spreads).toEqual([])
    expect(JSON.stringify(snapshot)).not.toContain('9.99')
  })

  it('ignores every series this boundary does not admit', () => {
    const snapshot = query([
      event({ metricKey: 'DXY_PROXY', actual: 121.5 }),
      event({ metricKey: 'FED_BALANCE_SHEET', actual: 6_500_000 })
    ]).snapshot()

    expect(snapshot).toMatchObject({ state: 'empty', readings: [], spreads: [] })
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
    const snapshot = published(query([event(overrides)]).snapshot())

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
      store: { series: () => { throw new Error('store-unavailable') } },
      now: () => now
    })

    expect(failing.snapshot()).toEqual({ state: 'unavailable' })
  })

  it('answers unavailable instead of empty when the event store fails', () => {
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
    const store = openStore()
    const listMetricEvents = vi.fn(() => [])
    const live = createMacroRatesSnapshotQuery({ store, listMetricEvents, now: () => now })

    live.snapshot()
    live.snapshot()

    expect(listMetricEvents).toHaveBeenCalledTimes(2)
    store.close()
  })
})
