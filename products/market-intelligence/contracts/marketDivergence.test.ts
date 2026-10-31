import { describe, expect, it } from 'vitest'

import {
  detectDivergences,
  divergencePolicy,
  isCanonicalDivergenceTime,
  type DivergenceInputs
} from './marketDivergence'

const asOf = '2026-10-30T12:00:00.000Z'
const at = (hoursAgo: number) => new Date(Date.parse(asOf) - hoursAgo * 3_600_000).toISOString()
const session = (daysAgo: number) => new Date(Date.parse(asOf) - daysAgo * 86_400_000).toISOString().slice(0, 10)

/** All three pairs hold; each test spoils one leg. */
function inputs(overrides: Partial<DivergenceInputs> = {}): DivergenceInputs {
  return {
    asOf,
    stablecoin: { change7dPercent: -1.2, observedAt: at(2) },
    etf: { rows: [{ tradingDate: session(1), netFlowUsd: -60e6 }, { tradingDate: session(2), netFlowUsd: -50e6 }, { tradingDate: session(3), netFlowUsd: -40e6 }] },
    openInterest: { change24hPct: 3.4, observedAt: at(1) },
    funding: { ratePercent: -0.0032, observedAt: at(1) },
    price: { return24hPercent: 0.2, observedAt: at(1) },
    sentiment: { bearishSharePercent: 72, scoredCount: 11, observedAt: at(1) },
    ...overrides
  }
}

describe('divergence pairs', () => {
  it('names the three configured pairs and refuses anything else', () => {
    expect([...divergencePolicy.pairs]).toEqual(['liquidity-leverage', 'flows-price', 'narrative-price'])
  })

  it('reports money leaving while open interest rises and shorts pay', () => {
    const result = detectDivergences(inputs())
    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    const row = result.rows.find(entry => entry.pairId === 'liquidity-leverage')!
    expect(row.direction).toBe('bearish')
    expect(row.legs.map(leg => leg.id)).toEqual(['stablecoin', 'open-interest', 'funding'])
    expect(row.direction).toBe('bearish')
  })

  it('stays quiet when the legs agree — agreement is the default state, not a row', () => {
    const result = detectDivergences(inputs({
      stablecoin: { change7dPercent: -1.2, observedAt: at(2) },
      openInterest: { change24hPct: -4, observedAt: at(1) },
      price: { return24hPercent: -2, observedAt: at(1) },
      sentiment: { bearishSharePercent: 20, scoredCount: 9, observedAt: at(1) }
    }))
    expect(result.state).toBe('empty')
    if (result.state !== 'empty') return
    expect(result.rows ?? []).toHaveLength(0)
    expect(result.withheld).toHaveLength(0)
  })

  it('reads spot absorbing a sell-off as the bullish case', () => {
    const result = detectDivergences(inputs({ openInterest: { change24hPct: -3.5, observedAt: at(1) } }))
    if (result.state !== 'available') throw new Error('expected rows')
    const row = result.rows.find(entry => entry.pairId === 'flows-price')!
    expect(row.direction).toBe('bullish')
    expect(row.legs.find(leg => leg.id === 'etf')!.value).toBe(-150e6)
  })

  it('marks bad news that changed nothing as unpriced', () => {
    const result = detectDivergences(inputs({ openInterest: { change24hPct: 0.2, observedAt: at(1) } }))
    if (result.state !== 'available') throw new Error('expected rows')
    const row = result.rows.find(entry => entry.pairId === 'narrative-price')!
    expect(row.direction).toBe('unpriced')
    expect(row.legs.find(leg => leg.id === 'sentiment')!.value).toBe(72)
  })
})

describe('window alignment', () => {
  it('refuses a pair whose daily leg describes an older day', () => {
    // Friday's ETF session on a Monday morning: the market was shut in between.
    const result = detectDivergences(inputs({ asOf: '2026-11-02T12:00:00.000Z', stablecoin: { change7dPercent: -1.2, observedAt: '2026-11-02T06:00:00.000Z' }, openInterest: { change24hPct: 3.4, observedAt: '2026-11-02T11:00:00.000Z' }, funding: { ratePercent: -0.0032, observedAt: '2026-11-02T11:00:00.000Z' }, price: { return24hPercent: 0.2, observedAt: '2026-11-02T11:00:00.000Z' } }))
    if (result.state === 'unavailable') throw new Error('unexpected')
    expect(result.withheld).toContainEqual(expect.objectContaining({ pairId: 'flows-price', reason: 'window-mismatch', leg: 'etf' }))
    expect(result.rows.some(row => row.pairId === 'flows-price')).toBe(false)
  })

  it('refuses instead of showing a half pair when a leg is missing', () => {
    const result = detectDivergences(inputs({ funding: undefined }))
    if (result.state === 'unavailable') throw new Error('unexpected')
    expect(result.withheld).toContainEqual({ pairId: 'liquidity-leverage', reason: 'leg-missing', leg: 'funding' })
    const rows = result.state === 'available' ? result.rows : []
    expect(rows.some(row => row.pairId === 'liquidity-leverage')).toBe(false)
  })

  it('names the stale leg rather than using an old reading', () => {
    const result = detectDivergences(inputs({ openInterest: { change24hPct: 3.4, observedAt: at(20) } }))
    if (result.state === 'unavailable') throw new Error('unexpected')
    expect(result.withheld).toContainEqual({ pairId: 'liquidity-leverage', reason: 'leg-stale', leg: 'open-interest' })
  })

  it('judges funding on its own settlement cycle: seven hours old is the freshest reading there is', () => {
    const result = detectDivergences(inputs({ funding: { ratePercent: -0.0032, observedAt: at(7) } }))
    if (result.state === 'unavailable') throw new Error('unexpected')
    expect(result.withheld.some(entry => entry.leg === 'funding')).toBe(false)
    expect(result.state === 'available' && result.rows.some(row => row.pairId === 'liquidity-leverage')).toBe(true)
  })

  it('still calls funding stale past one settlement cycle plus a poll of slack', () => {
    const result = detectDivergences(inputs({ funding: { ratePercent: -0.0032, observedAt: at(10) } }))
    if (result.state === 'unavailable') throw new Error('unexpected')
    expect(result.withheld).toContainEqual({ pairId: 'liquidity-leverage', reason: 'leg-stale', leg: 'funding' })
  })

  it('separates a leg that could not be read from one the market never sent', () => {
    const unreadable = detectDivergences(inputs({ price: undefined, faulted: ['price'] }))
    const absent = detectDivergences(inputs({ price: undefined }))
    if (unreadable.state === 'unavailable' || absent.state === 'unavailable') throw new Error('unexpected')
    expect(unreadable.withheld).toContainEqual({ pairId: 'flows-price', reason: 'leg-unavailable', leg: 'price' })
    expect(absent.withheld).toContainEqual({ pairId: 'flows-price', reason: 'leg-missing', leg: 'price' })
  })

  it('needs three finished sessions before it will sum ETF flows', () => {
    const result = detectDivergences(inputs({ etf: { rows: [{ tradingDate: session(1), netFlowUsd: -60e6 }] } }))
    if (result.state === 'unavailable') throw new Error('unexpected')
    expect(result.withheld).toContainEqual({ pairId: 'flows-price', reason: 'leg-stale', leg: 'etf' })
  })

  it('returns empty, not unavailable, when every pair is withheld', () => {
    const result = detectDivergences(inputs({ stablecoin: undefined, etf: undefined, sentiment: undefined }))
    expect(result.state).toBe('empty')
    if (result.state !== 'empty') return
    expect(result.withheld).toHaveLength(3)
  })

  it('refuses a clock that is not canonical UTC', () => {
    expect(detectDivergences({ ...inputs(), asOf: '2026-10-30 12:00' }).state).toBe('unavailable')
    expect(isCanonicalDivergenceTime('2026-10-30T12:00:00.000Z')).toBe(true)
    expect(isCanonicalDivergenceTime('2026-10-30T12:00:00Z')).toBe(false)
  })
})
