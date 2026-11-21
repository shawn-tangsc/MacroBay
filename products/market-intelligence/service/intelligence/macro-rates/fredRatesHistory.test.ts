import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createMacroMarketStore, type MacroMarketStore } from '../macro-market/macroMarketStore'
import { createFredRatesHistorySink, fredRatesHistoryPoints } from './fredRatesHistory'
import { macroMarketRatesSeries, macroMarketRatesSeriesIds } from '../macro-market/macroMarketSeries'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

const openStore = (): MacroMarketStore => {
  const directory = mkdtempSync(join(tmpdir(), 'fred-rates-history-')); directories.push(directory)
  return createMacroMarketStore(join(directory, 'macro-market.sqlite'))
}

const nowMs = Date.UTC(2026, 11, 1, 12, 0, 0)
const dayMs = 24 * 3_600_000

/** `count` trading days ending on `endDate` (a `YYYY-MM-DD`), weekends skipped like FRED does. */
function tradingDays(endDate: string, count: number): string[] {
  const days: string[] = []
  const cursor = new Date(`${endDate}T00:00:00.000Z`)
  while (days.length < count) {
    const weekday = cursor.getUTCDay()
    if (weekday !== 0 && weekday !== 6) days.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return days.reverse()
}

/**
 * A FRED answer in the provider's own shape: `sort_order=desc`, one row per calendar day, `.` for a
 * day it has no value for. The window ends on the acceptance sample's day so the numbers can be read
 * back as the panel would read them.
 */
function fredPayload(rows: readonly { date: string; value: string }[]) {
  return { realtime_start: '2026-12-01', realtime_end: '2026-12-01', observations: [...rows].reverse() }
}

const sampleDays = tradingDays('2026-11-10', 400)

describe('fredRatesHistoryPoints', () => {
  it('turns the whole 400-observation window into daily points, not just the newest one', () => {
    const rows = sampleDays.map((date, index) => ({ date, value: (4 + index / 1_000).toFixed(2) }))
    const points = fredRatesHistoryPoints({ payload: fredPayload(rows), providerSeriesId: 'DGS2', observedAtMs: nowMs })

    expect(points).toHaveLength(400)
    expect(points[0]).toMatchObject({ series: 'ust-2y', atMs: Date.parse(`${sampleDays[0]}T00:00:00.000Z`), value: 4 })
    // The payload carries two decimals, so the last row is 4.40 — the store keeps the level it was given.
    expect(points.at(-1)).toMatchObject({
      series: 'ust-2y', atMs: Date.parse('2026-11-10T00:00:00.000Z'), value: 4.4, observedAtMs: nowMs
    })
  })

  it('keeps a `.` day as a gap: it is absent rather than stored as 0%', () => {
    const payload = fredPayload([
      { date: '2026-11-06', value: '4.50' },
      { date: '2026-11-09', value: '.' },
      { date: '2026-11-10', value: '4.73' }
    ])
    const points = fredRatesHistoryPoints({ payload, providerSeriesId: 'DGS2', observedAtMs: nowMs })

    expect(points.map(point => new Date(point.atMs).toISOString().slice(0, 10))).toEqual(['2026-11-06', '2026-11-10'])
    expect(points.map(point => point.value)).toEqual([4.5, 4.73])
  })

  it('maps the admitted series to instrument names, not to the provider', () => {
    expect(Object.keys(macroMarketRatesSeries)).toHaveLength(7)
    expect(macroMarketRatesSeries).toEqual({
      DGS3MO: 'ust-3m', DGS2: 'ust-2y', DGS5: 'ust-5y', DGS10: 'ust-10y', DGS30: 'ust-30y',
      DFII10: 'ust-10y-real', T10YIE: 'ust-10y-breakeven'
    })
    expect(macroMarketRatesSeriesIds).toHaveLength(7)
    expect(macroMarketRatesSeriesIds).toEqual([
      'ust-3m', 'ust-2y', 'ust-5y', 'ust-10y', 'ust-30y', 'ust-10y-real', 'ust-10y-breakeven'
    ])
    const series = Object.keys(macroMarketRatesSeries).map(providerSeriesId =>
      fredRatesHistoryPoints({
        payload: fredPayload([{ date: '2026-11-10', value: '1.25' }]), providerSeriesId, observedAtMs: nowMs
      })[0]?.series)
    expect(series).toEqual(macroMarketRatesSeriesIds)
  })

  it('drops a row whose date or value cannot be read, and an unmapped series yields nothing', () => {
    const payload = fredPayload([
      { date: '2026-11-09', value: '4.56' },
      { date: '2026-11-1', value: '4.60' },
      { date: '2026-11-10', value: 'abc' }
    ])
    expect(fredRatesHistoryPoints({ payload, providerSeriesId: 'DGS2', observedAtMs: nowMs }))
      .toEqual([{ series: 'ust-2y', atMs: Date.parse('2026-11-09T00:00:00.000Z'), value: 4.56, observedAtMs: nowMs }])
    expect(fredRatesHistoryPoints({ payload, providerSeriesId: 'UNKNOWN', observedAtMs: nowMs })).toEqual([])
  })
})

describe('createFredRatesHistorySink', () => {
  const meta = JSON.stringify({ seriesId: 'DGS2', metricKey: 'US_2Y_YIELD' })

  it('stores the window and writes nothing a second time: the key is the series and the trading day', () => {
    const store = openStore()
    const sink = createFredRatesHistorySink({ store, now: () => nowMs })
    const payloadBody = JSON.stringify(fredPayload([
      { date: '2026-11-09', value: '4.56' },
      { date: '2026-11-10', value: '4.73' }
    ]))

    expect(sink({ sourceId: 'fred-rates-liquidity', payloadBody, payloadMetaJson: meta })).toEqual({ state: 'stored', added: 2 })
    expect(sink({ sourceId: 'fred-rates-liquidity', payloadBody, payloadMetaJson: meta })).toEqual({ state: 'unchanged', added: 0 })
    expect(store.count('ust-2y')).toBe(2)
    expect(store.series('ust-2y', 0, Number.MAX_SAFE_INTEGER)).toEqual([
      { atMs: Date.parse('2026-11-09T00:00:00.000Z'), value: 4.56 },
      { atMs: Date.parse('2026-11-10T00:00:00.000Z'), value: 4.73 }
    ])
    store.close()
  })

  it('writes every admitted series side by side in one store, each under its own instrument name', () => {
    const store = openStore()
    const sink = createFredRatesHistorySink({ store, now: () => nowMs })
    for (const [providerSeriesId, series] of Object.entries(macroMarketRatesSeries)) {
      sink({
        sourceId: 'fred-rates-liquidity',
        payloadBody: JSON.stringify(fredPayload([{ date: '2026-11-10', value: '2.00' }])),
        payloadMetaJson: JSON.stringify({ seriesId: providerSeriesId, metricKey: 'X' })
      })
      expect(store.count(series)).toBe(1)
    }
    expect(store.count()).toBe(macroMarketRatesSeriesIds.length)
    store.close()
  })

  it('ignores another source, an unmapped series, a body it cannot parse, and never throws', () => {
    const store = openStore()
    const sink = createFredRatesHistorySink({ store, now: () => nowMs })
    const goodPayload = JSON.stringify(fredPayload([{ date: '2026-11-10', value: '4.73' }]))

    expect(sink({ sourceId: 'bls-economic-series', payloadBody: goodPayload, payloadMetaJson: meta })).toEqual({ state: 'skipped', added: 0 })
    expect(sink({ sourceId: 'fred-rates-liquidity', payloadBody: goodPayload, payloadMetaJson: JSON.stringify({ seriesId: 'DTWEXBGS' }) }))
      .toEqual({ state: 'unrecognized', added: 0 })
    expect(sink({ sourceId: 'fred-rates-liquidity', payloadBody: '{not json', payloadMetaJson: meta })).toEqual({ state: 'skipped', added: 0 })
    expect(sink({ sourceId: 'fred-rates-liquidity', payloadMetaJson: meta })).toEqual({ state: 'skipped', added: 0 })
    expect(store.count()).toBe(0)
    store.close()
  })

  it('keeps every stored day when the window is a hundred days older than the store', () => {
    const store = openStore()
    const sink = createFredRatesHistorySink({ store, now: () => nowMs })
    const payloadBody = JSON.stringify(fredPayload(sampleDays.map((date, index) => ({ date, value: String(3 + index / 100) }))))
    sink({ sourceId: 'fred-rates-liquidity', payloadBody, payloadMetaJson: meta })

    expect(store.count('ust-2y')).toBe(400)
    expect(store.earliest('ust-2y')?.atMs).toBe(Date.parse(`${sampleDays[0]}T00:00:00.000Z`))
    // The window starts about a year and a half before the newest day, far outside the bar horizon.
    expect(nowMs - (store.earliest('ust-2y')?.atMs ?? nowMs)).toBeGreaterThan(100 * dayMs)
    store.close()
  })
})