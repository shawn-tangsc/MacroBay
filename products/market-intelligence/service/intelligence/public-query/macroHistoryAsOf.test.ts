import { describe, expect, it } from 'vitest'

import {
  createMacroHistoryAsOfQuery,
  type MacroHistoryAsOfDeps
} from './macroHistoryAsOf'
import type { MacroMarketStore } from '../macro-market/macroMarketStore'
import type { MetricIntelligenceEvent } from '../schema/intelligenceMetricEvent'

/** The 08:00 edition cutoff in Asia/Shanghai, which is midnight UTC. */
const CUTOFF = '2026-10-30T00:00:00.000Z'
/** 21:00 the same local day: the moment the edition is actually generated. */
const GENERATED_AT = '2026-10-30T13:00:00.000Z'
const NOW_MS = Date.parse(GENERATED_AT)

type Point = Readonly<{ series: string; atMs: number; value: number }>

/** The store's as-of read, over a fixture: newest point at or before the instant, per series. */
function store(points: readonly Point[]): Pick<MacroMarketStore, 'latestAt'> {
  return {
    latestAt: (seriesId, atOrBeforeMs) => {
      const rows = points.filter((point) => point.series === seriesId && point.atMs <= atOrBeforeMs)
        .sort((left, right) => left.atMs - right.atMs)
      const latest = rows.at(-1)
      return latest ? { atMs: latest.atMs, value: latest.value } : undefined
    }
  }
}

function rateEvent(overrides: Partial<MetricIntelligenceEvent> = {}): MetricIntelligenceEvent {
  return {
    metricEventId: 'metric-1',
    itemId: 'item-1',
    sourceId: 'fred-rates-liquidity',
    metricKey: 'US_10Y_YIELD',
    metricName: 'US 10Y Yield',
    metricKind: 'treasury-yield',
    actual: 4.15,
    period: '2026-10-29',
    releaseTime: '2026-10-29T00:00:00.000Z',
    comparisonBasis: 'level',
    surpriseDirection: 'unknown',
    metricVersion: 'v1',
    ...overrides
  }
}

function query(overrides: Partial<MacroHistoryAsOfDeps> = {}) {
  return createMacroHistoryAsOfQuery({ now: () => NOW_MS, ...overrides })
}

const points: readonly Point[] = [
  { series: 'dxy-real', atMs: Date.parse('2026-10-29T23:55:00.000Z'), value: 100.2 },
  // The 21:00 read: stored, but it describes a market the 08:00 handoff never saw.
  { series: 'dxy-real', atMs: Date.parse('2026-10-30T12:55:00.000Z'), value: 101.5 },
  { series: 'xau-usd', atMs: Date.parse('2026-10-29T23:50:00.000Z'), value: 4150.25 },
  { series: 'xau-usd', atMs: Date.parse('2026-10-30T12:50:00.000Z'), value: 4200 }
]

describe('macro history as-of projection', () => {
  it('answers the dollar as it stood at the cutoff, not the bar collected hours later', () => {
    const result = query({ macroMarket: store(points) }).read({ series: 'dxy', asOf: CUTOFF })

    expect(result).toEqual({
      state: 'available',
      series: 'dxy',
      seriesId: 'dxy-real',
      asOf: CUTOFF,
      value: 100.2,
      observedAt: '2026-10-29T23:55:00.000Z',
      method: 'dxy-store-as-of',
      sourceUrl: 'https://api.realmarketapi.com/api/v1/price'
    })
  })

  it('answers gold at the instant, and never the newer bar', () => {
    const result = query({ macroMarket: store(points) }).read({ series: 'gold', asOf: CUTOFF })

    expect(result).toMatchObject({
      state: 'available', seriesId: 'xau-usd', value: 4150.25,
      observedAt: '2026-10-29T23:50:00.000Z', method: 'gold-store-as-of'
    })
  })

  it('keeps the licensed dollar while it exists, and labels the synthesis only while it is newer', () => {
    const syntheticOlder = [
      ...points,
      { series: 'dxy-synthetic', atMs: Date.parse('2026-10-29T23:45:00.000Z'), value: 100.1 }
    ]
    expect(query({ macroMarket: store(syntheticOlder) }).read({ series: 'dxy', asOf: CUTOFF }))
      .toMatchObject({ state: 'available', seriesId: 'dxy-real', value: 100.2 })

    const syntheticNewer = [
      { series: 'dxy-real', atMs: Date.parse('2026-10-29T20:00:00.000Z'), value: 99.4 },
      { series: 'dxy-synthetic', atMs: Date.parse('2026-10-29T23:45:00.000Z'), value: 100.1 }
    ]
    const fallback = query({ macroMarket: store(syntheticNewer) }).read({ series: 'dxy', asOf: CUTOFF })
    expect(fallback).toMatchObject({
      state: 'available', seriesId: 'dxy-synthetic', value: 100.1,
      method: 'dxy-basket-synthesis-as-of', synthetic: true
    })
    // The computed level must never be presented under the licensed index's provenance.
    expect(fallback.state === 'available' && fallback.sourceUrl).toBe('https://api.twelvedata.com')
  })

  it('answers historical-as-of-unavailable rather than a current value when no history exists', () => {
    expect(query().read({ series: 'dxy', asOf: CUTOFF })).toMatchObject({
      state: 'unavailable', gapCode: 'historical-as-of-unavailable'
    })
    // A store that only holds bars collected *after* the instant cannot answer it either.
    const later = [{ series: 'dxy-real', atMs: Date.parse('2026-10-30T12:55:00.000Z'), value: 101.5 }]
    const result = query({ macroMarket: store(later) }).read({ series: 'dxy', asOf: CUTOFF })
    expect(result).toMatchObject({ state: 'unavailable', gapCode: 'historical-as-of-unavailable' })
    expect('value' in result).toBe(false)
  })

  it('keeps a FRED close only once its observation day has ended', () => {
    const listMetricEvents = () => [
      rateEvent({ metricEventId: 'u-1', period: '2026-10-28', releaseTime: '2026-10-28T00:00:00.000Z', actual: 4.10 }),
      rateEvent({ metricEventId: 'u-2', period: '2026-10-29', releaseTime: '2026-10-29T00:00:00.000Z', actual: 4.15 })
    ]
    const atCutoff = query({ listMetricEvents }).read({ series: 'us10y', asOf: CUTOFF })
    expect(atCutoff).toEqual({
      state: 'available',
      series: 'us10y',
      seriesId: 'DGS10',
      asOf: CUTOFF,
      value: 4.15,
      observedAt: '2026-10-29T00:00:00.000Z',
      method: 'fred-daily-close-as-of',
      sourceUrl: 'https://fred.stlouisfed.org/series/DGS10',
      period: '2026-10-29'
    })

    // Mid-day on the 29th, that day's close is not published yet: the 28th is the newest fact.
    const midday = query({ listMetricEvents }).read({ series: 'us10y', asOf: '2026-10-29T12:00:00.000Z' })
    expect(midday).toMatchObject({ state: 'available', value: 4.10, period: '2026-10-28' })
  })

  it('reads the real 10-year from its own FRED series', () => {
    const listMetricEvents = () => [
      rateEvent({ metricKey: 'US_REAL_YIELD_10Y', actual: 1.85 }),
      rateEvent({ metricEventId: 'u-2', metricKey: 'US_2Y_YIELD', actual: 4.0 })
    ]
    expect(query({ listMetricEvents }).read({ series: 'us10y-real', asOf: CUTOFF })).toMatchObject({
      state: 'available', seriesId: 'DFII10', value: 1.85,
      sourceUrl: 'https://fred.stlouisfed.org/series/DFII10'
    })
  })

  it('drops a close whose release stamp is ahead of the instant', () => {
    const listMetricEvents = () => [
      rateEvent({ period: '2026-10-28', releaseTime: '2026-10-29T23:00:00.000Z', actual: 4.10 })
    ]
    expect(query({ listMetricEvents }).read({ series: 'us10y', asOf: '2026-10-29T12:00:00.000Z' }))
      .toMatchObject({ state: 'unavailable', gapCode: 'historical-as-of-unavailable' })
    // At the cutoff the release has happened, and the same close becomes visible.
    expect(query({ listMetricEvents }).read({ series: 'us10y', asOf: CUTOFF }))
      .toMatchObject({ state: 'available', value: 4.10 })
  })

  it('skips a day the store contradicts itself about instead of resolving it by row order', () => {
    const listMetricEvents = () => [
      rateEvent({ metricEventId: 'u-1', period: '2026-10-28', releaseTime: '2026-10-28T00:00:00.000Z', actual: 4.10 }),
      rateEvent({ metricEventId: 'u-2', period: '2026-10-29', releaseTime: '2026-10-29T00:00:00.000Z', actual: 4.15 }),
      rateEvent({ metricEventId: 'u-3', period: '2026-10-29', releaseTime: '2026-10-29T00:00:00.000Z', actual: 4.19 })
    ]
    expect(query({ listMetricEvents }).read({ series: 'us10y', asOf: CUTOFF }))
      .toMatchObject({ state: 'available', value: 4.10, period: '2026-10-28' })
  })

  it('ignores a FRED event from another source, another series or an unreadable period', () => {
    const listMetricEvents = () => [
      rateEvent({ sourceId: 'fred-macro-legacy' }),
      rateEvent({ metricEventId: 'u-2', metricKey: 'US_2Y_YIELD' }),
      rateEvent({ metricEventId: 'u-3', period: '2026-10-2' }),
      rateEvent({ metricEventId: 'u-4', actual: Number.NaN })
    ]
    expect(query({ listMetricEvents }).read({ series: 'us10y', asOf: CUTOFF }))
      .toMatchObject({ state: 'unavailable', gapCode: 'historical-as-of-unavailable' })
  })

  it('refuses a malformed or future instant and an unknown series', () => {
    const q = query({ macroMarket: store(points) })
    expect(q.read({ series: 'dxy', asOf: '2026-10-30' })).toMatchObject({ gapCode: 'invalid-as-of' })
    expect(q.read({ series: 'dxy', asOf: '2026-10-30T13:00:00.001Z' })).toMatchObject({ gapCode: 'future-as-of' })
    expect(q.read({ series: 'spx' as never, asOf: CUTOFF })).toMatchObject({ gapCode: 'unknown-series' })
  })

  it('turns a throwing store into a named gap instead of a failed read', () => {
    const throwing = { latestAt: () => { throw new Error('store down') } }
    expect(query({ macroMarket: throwing }).read({ series: 'gold', asOf: CUTOFF }))
      .toMatchObject({ state: 'unavailable', gapCode: 'query-unavailable' })
  })
})
