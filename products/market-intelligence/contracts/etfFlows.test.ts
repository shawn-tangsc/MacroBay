import { describe, expect, it } from 'vitest'

import { computeEtfCumulativeFlow, etfFlowPolicy, latestCompleteWindow } from './etfFlows'

/** The two windows the panel and the analysis snapshot read. */
const WINDOWS = etfFlowPolicy.cumulativeWindows
/** The one window the outflow rule judges. */
const SIGNAL = [etfFlowPolicy.signalWindowDays]

describe('ETF cumulative flow', () => {
  it('sums the latest N trading rows for a complete 20-day window', () => {
    expect(computeEtfCumulativeFlow(rows(Array.from({ length: 20 }, (_, index) => index + 1)), WINDOWS)).toEqual([
      { windowDays: 5, coveredDays: 5, netFlowUsd: 90, complete: true },
      { windowDays: 20, coveredDays: 20, netFlowUsd: 210, complete: true }
    ])
  })

  it('marks a 20-day window incomplete when the source supplies only 12 days', () => {
    expect(computeEtfCumulativeFlow(rows(Array.from({ length: 12 }, (_, index) => index + 1)), WINDOWS)).toEqual([
      { windowDays: 5, coveredDays: 5, netFlowUsd: 50, complete: true },
      { windowDays: 20, coveredDays: 12, netFlowUsd: 78, complete: false }
    ])
  })

  it('treats exactly five rows as a complete five-day window and an incomplete 20-day window', () => {
    expect(computeEtfCumulativeFlow(rows([10, -4, 0, 3, -2]), WINDOWS)).toEqual([
      { windowDays: 5, coveredDays: 5, netFlowUsd: 7, complete: true },
      { windowDays: 20, coveredDays: 5, netFlowUsd: 7, complete: false }
    ])
  })

  it('counts zero-flow rows as coverage and sums them as zero', () => {
    const values = Array.from({ length: 20 }, (_, index) => index >= 18 ? 0 : 1)
    expect(computeEtfCumulativeFlow(rows(values), WINDOWS)).toEqual([
      { windowDays: 5, coveredDays: 5, netFlowUsd: 3, complete: true },
      { windowDays: 20, coveredDays: 20, netFlowUsd: 18, complete: true }
    ])
  })

  it('keeps an all-negative window negative', () => {
    expect(computeEtfCumulativeFlow(rows(Array.from({ length: 20 }, () => -1.5)), WINDOWS)).toEqual([
      { windowDays: 5, coveredDays: 5, netFlowUsd: -7.5, complete: true },
      { windowDays: 20, coveredDays: 20, netFlowUsd: -30, complete: true }
    ])
  })

  it('normalizes out-of-order rows by tradingDate without mutating the input', () => {
    const input = rows(Array.from({ length: 20 }, (_, index) => index + 1))
    const shuffled = [...input].reverse()
    const before = shuffled.map((row) => row.tradingDate)

    expect(computeEtfCumulativeFlow(shuffled, WINDOWS)).toEqual([
      { windowDays: 5, coveredDays: 5, netFlowUsd: 90, complete: true },
      { windowDays: 20, coveredDays: 20, netFlowUsd: 210, complete: true }
    ])
    expect(shuffled.map((row) => row.tradingDate)).toEqual(before)
  })

  it('counts trading rows across weekend gaps instead of calendar days', () => {
    const tradingDates = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-06', '2026-07-07']
    const gapRows = tradingDates.map((tradingDate, index) => ({ tradingDate, netFlowUsd: index + 1 }))
    expect(computeEtfCumulativeFlow(gapRows, WINDOWS)).toEqual([
      { windowDays: 5, coveredDays: 5, netFlowUsd: 15, complete: true },
      { windowDays: 20, coveredDays: 5, netFlowUsd: 15, complete: false }
    ])
  })

  it('rejects duplicate trading dates instead of merging revisions', () => {
    expect(computeEtfCumulativeFlow([
      { tradingDate: '2026-07-01', netFlowUsd: 1 },
      { tradingDate: '2026-07-02', netFlowUsd: 2 },
      { tradingDate: '2026-07-02', netFlowUsd: 3 }
    ], WINDOWS)).toBeUndefined()
  })

  it('returns undefined for empty input instead of reporting a zero window', () => {
    expect(computeEtfCumulativeFlow([], WINDOWS)).toBeUndefined()
  })

  it('reports single-row coverage without inventing missing days', () => {
    expect(computeEtfCumulativeFlow(rows([7]), WINDOWS)).toEqual([
      { windowDays: 5, coveredDays: 1, netFlowUsd: 7, complete: false },
      { windowDays: 20, coveredDays: 1, netFlowUsd: 7, complete: false }
    ])
  })

  it.each([
    ['a missing netFlowUsd', [{ tradingDate: '2026-07-01' }]],
    ['a non-numeric netFlowUsd', [{ tradingDate: '2026-07-01', netFlowUsd: '1' }]],
    ['a non-finite netFlowUsd', [{ tradingDate: '2026-07-01', netFlowUsd: Number.POSITIVE_INFINITY }]],
    ['a negative-zero netFlowUsd', [{ tradingDate: '2026-07-01', netFlowUsd: -0 }]],
    ['a missing tradingDate', [{ netFlowUsd: 1 }]],
    ['an impossible tradingDate', [{ tradingDate: '2026-02-30', netFlowUsd: 1 }]],
    ['a non-canonical tradingDate', [{ tradingDate: '2026-7-1', netFlowUsd: 1 }]],
    ['a non-row entry', [null]]
  ])('fails closed for %s', (_label, input) => {
    expect(computeEtfCumulativeFlow(input, WINDOWS)).toBeUndefined()
  })

  it('fails closed for a non-array input', () => {
    expect(computeEtfCumulativeFlow(undefined, WINDOWS)).toBeUndefined()
    expect(computeEtfCumulativeFlow({ rows: [] }, WINDOWS)).toBeUndefined()
  })
})

describe('window lengths are the caller’s', () => {
  it('answers only the window it was asked for', () => {
    expect(computeEtfCumulativeFlow(rows(Array.from({ length: 20 }, (_, index) => index + 1)), SIGNAL)).toEqual([
      { windowDays: 3, coveredDays: 3, netFlowUsd: 57, complete: true }
    ])
  })

  it('keeps the three-day window incomplete on two days of data', () => {
    expect(computeEtfCumulativeFlow(rows([-4, -9]), SIGNAL)).toEqual([
      { windowDays: 3, coveredDays: 2, netFlowUsd: -13, complete: false }
    ])
  })

  it('fails closed for a window list that repeats or names no window', () => {
    expect(computeEtfCumulativeFlow(rows([1, 2, 3]), [3, 3])).toBeUndefined()
    expect(computeEtfCumulativeFlow(rows([1, 2, 3]), [])).toBeUndefined()
    expect(computeEtfCumulativeFlow(rows([1, 2, 3]), [0])).toBeUndefined()
    expect(computeEtfCumulativeFlow(rows([1, 2, 3]), [1.5])).toBeUndefined()
  })
})

describe('reading one window back', () => {
  it('returns the window only when it was complete', () => {
    const complete = computeEtfCumulativeFlow(rows([-40, -40, -40]), SIGNAL)
    expect(latestCompleteWindow(complete, 3)).toMatchObject({ windowDays: 3, complete: true })

    const short = computeEtfCumulativeFlow(rows([-40, -40]), SIGNAL)
    expect(latestCompleteWindow(short, 3)).toBeUndefined()
  })

  it('does not answer for a window that was never computed', () => {
    expect(latestCompleteWindow(computeEtfCumulativeFlow(rows([1, 2, 3]), SIGNAL), 5)).toBeUndefined()
    expect(latestCompleteWindow(undefined, 3)).toBeUndefined()
  })
})

function rows(values: readonly number[], firstDate = '2026-07-01'): { tradingDate: string; netFlowUsd: number }[] {
  const start = Date.parse(`${firstDate}T00:00:00.000Z`)
  return values.map((netFlowUsd, index) => ({
    tradingDate: new Date(start + index * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10),
    netFlowUsd
  }))
}
