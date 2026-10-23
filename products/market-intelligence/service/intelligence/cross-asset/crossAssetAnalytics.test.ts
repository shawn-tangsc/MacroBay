import { describe, expect, it } from 'vitest'

import { analyzeCrossAssetHistory } from './crossAssetAnalytics'

// Derived numerical contract cases from design 126; not source admission evidence.
const step = 300_000
const end = Date.parse('2026-09-14T12:00:00.000Z')
const series = (count: number, price: (index: number) => number) => Array.from({ length: count }, (_, index) => ({
  atMs: end - (count - 1 - index) * step, close: String(price(index))
}))
const rising = (count = 289) => series(count, index => 100 * Math.exp(index * .001 + Math.sin(index) * .0002))
const run = (history: Parameters<typeof analyzeCrossAssetHistory>[0]['history'], range: '1h' | '24h' | '7d' = '1h', asOfMs = end) =>
  analyzeCrossAssetHistory({ history, range, asOfMs, mode: 'historical' })

describe('cross-asset closed history analytics', () => {
  it('keeps one-hour observation coverage and anchor prices independent of chart range', () => {
    const prices = rising()
    const result = run({ index: prices, btc: prices.filter((_, index) => index !== 282), eth: prices }, '24h')
    expect(result.observationCoverage).toEqual({ index: true, btc: false, eth: true })
    expect(result.anchorPrices.index).toBe(Number(prices[0].close))
    expect(result.latestClosedPresent).toEqual({ index: true, btc: true, eth: true })
    expect(run({ index: prices.slice(0, -1), btc: prices, eth: prices }).latestClosedPresent.index).toBe(false)
  })
  it('uses the same exact UTC anchor and relative percentage points', () => {
    const result = run({ index: series(13, i => 100 + i / 12), btc: series(13, i => 200 + i / 3), eth: series(13, i => 50 + i / 8) })
    expect(result.analysisEndMs).toBe(end)
    expect(result.windowStartMs).toBe(end - 12 * step)
    expect(result.curves.index.at(-1)?.returnPercent).toBeCloseTo(1)
    expect(result.curves.btc.at(-1)?.returnPercent).toBeCloseTo(2)
    expect(result.curves.eth.at(-1)?.returnPercent).toBeCloseTo(3)
    expect(result.relativeReturns.btcMinusIndex).toMatchObject({ state: 'available', value: expect.closeTo(1) })
    expect(result.relativeReturns.ethMinusBtc).toMatchObject({ state: 'available', value: expect.closeTo(1) })
  })

  it('does not rebase an asset whose precise anchor is missing or fill a middle gap', () => {
    const prices = rising(13)
    const result = run({ index: prices.slice(1), btc: prices.filter((_, i) => i !== 6), eth: prices })
    expect(result.curves.index.every(point => point.returnPercent === null)).toBe(true)
    expect(result.curves.btc[6].returnPercent).toBeNull()
    expect(result.curves.eth).toHaveLength(13)
    expect(result.curves.eth[0].returnPercent).toBe(0)
    expect(result.historyCoverage.btc).toMatchObject({ count: 12, expectedCount: 13, complete: false })
  })

  it.each([230, 231])('requires 231 adjacent paired returns, with %s available', count => {
    const prices = rising(count + 1)
    const result = run({ index: prices, btc: prices, eth: [] })
    expect(result.correlations.indexBtc.sampleCount).toBe(count)
    expect(result.correlations.indexBtc.state).toBe(count === 230 ? 'unavailable' : 'available')
    if (result.correlations.indexBtc.state === 'available') expect(result.correlations.indexBtc.value).toBeCloseTo(1)
    expect(result.correlations.indexEth.state).toBe('unavailable')
  })

  it('excludes both returns adjacent to a gap and never shifts the analysis endpoint', () => {
    const prices = rising()
    const gap = prices.filter((_, i) => i !== 50)
    const result = run({ index: prices, btc: gap, eth: prices.slice(0, -1) })
    expect(result.correlations.indexBtc.sampleCount).toBe(286)
    expect(result.correlations.indexEth).toMatchObject({ state: 'unavailable', reason: 'missing' })
    expect(result.analysisEndMs).toBe(end)
  })

  it('computes inverse returns and rejects zero variance instead of manufacturing neutral correlation', () => {
    const prices = rising()
    const inverse = prices.map(point => ({ ...point, close: String(10000 / Number(point.close)) }))
    expect(run({ index: prices, btc: inverse, eth: prices }).correlations.indexBtc).toMatchObject({ state: 'available', value: expect.closeTo(-1) })
    expect(run({ index: series(289, () => 100), btc: prices, eth: [] }).correlations.indexBtc)
      .toMatchObject({ state: 'unavailable', reason: 'zero-variance' })
  })

  it('keeps 24h correlations and 1h relative returns independent of the chart range', () => {
    const history = { index: rising(), btc: rising(), eth: rising() }
    expect(run(history, '1h').correlations).toEqual(run(history, '24h').correlations)
    expect(run(history, '7d').relativeReturns).toEqual(run(history, '1h').relativeReturns)
  })

  it('samples 7d hourly positions but breaks every segment with a missing 5m close', () => {
    // Enough bars for the anchor at the far end of the seven-day window plus every hourly
    // segment the curve samples, so the only hole is the one this test deliberately makes.
    const prices = rising(2020)
    const result = run({ index: prices, btc: prices.filter((_, i) => i !== 6), eth: [] }, '7d')
    expect(result.curves.index).toHaveLength(169)
    expect(result.curves.btc[1].returnPercent).toBeNull()
    expect(result.curves.btc[2].returnPercent).not.toBeNull()
    expect(result.curves.index[1].atMs - result.curves.index[0].atMs).toBe(3_600_000)
  })

  it('uses UTC boundaries and ignores future points without inventing current history', () => {
    const prices = rising()
    const result = run({ index: prices, btc: prices, eth: prices }, '1h', end - 1)
    expect(result.analysisEndMs).toBe(end - step)
    expect(result.curves.index.at(-1)?.atMs).toBe(end - step)
    expect(result.closedReturns.index['5m'].state).toBe('available')
  })

  it('marks overdue missing endpoints stale only for current analysis', () => {
    const history = { index: rising().slice(0, -1), btc: rising(), eth: rising() }
    expect(analyzeCrossAssetHistory({ history, range: '1h', asOfMs: end + 90_001, mode: 'current' }).correlations.indexBtc)
      .toMatchObject({ state: 'unavailable', reason: 'stale' })
    expect(run(history, '1h', end + 90_001).correlations.indexBtc).toMatchObject({ reason: 'missing' })
  })
})
