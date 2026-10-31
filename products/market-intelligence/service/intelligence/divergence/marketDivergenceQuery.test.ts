import { describe, expect, it, vi } from 'vitest'

import { queryMarketDivergenceAsync, type DivergenceLegReader } from './marketDivergenceQuery'

const asOf = '2026-10-30T12:00:00.000Z'
const at = (hoursAgo: number) => new Date(Date.parse(asOf) - hoursAgo * 3_600_000).toISOString()
const session = (daysAgo: number) => new Date(Date.parse(asOf) - daysAgo * 86_400_000).toISOString().slice(0, 10)

function reader(overrides: Partial<DivergenceLegReader> = {}): DivergenceLegReader {
  return {
    stablecoin: async () => ({ change7dPercent: -1.2, observedAt: at(2) }),
    etf: async () => ({ rows: [1, 2, 3].map(days => ({ tradingDate: session(days), netFlowUsd: -50e6 })) }),
    openInterest: async () => ({ change24hPct: 3.4, observedAt: at(1) }),
    funding: async () => ({ ratePercent: -0.0032, observedAt: at(1) }),
    price: async () => ({ return24hPercent: 0.2, observedAt: at(1) }),
    sentiment: async () => ({ bearishSharePercent: 72, scoredCount: 11, observedAt: at(1) }),
    ...overrides
  }
}

describe('market divergence query', () => {
  it('answers with the rows the legs support', async () => {
    const result = await queryMarketDivergenceAsync({ asOf, read: reader() })
    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    expect(result.rows.map(row => row.pairId)).toContain('liquidity-leverage')
  })

  it('names a leg that answered nothing instead of failing the whole card', async () => {
    const result = await queryMarketDivergenceAsync({ asOf, read: reader({ stablecoin: async () => undefined }) })
    expect(result.withheld).toContainEqual({ pairId: 'liquidity-leverage', reason: 'leg-missing', leg: 'stablecoin' })
    if (result.state !== 'available') return
    expect(result.rows.map(row => row.pairId)).not.toContain('liquidity-leverage')
  })

  it('treats a throwing leg as an absent one', async () => {
    const boom = vi.fn(async () => { throw new Error('leg down') })
    const result = await queryMarketDivergenceAsync({ asOf, read: reader({ sentiment: boom as never }) })
    expect(result.withheld).toContainEqual({ pairId: 'narrative-price', reason: 'leg-missing', leg: 'sentiment' })
  })

  it('refuses a non-canonical instant without reading a single leg', async () => {
    const spy = vi.fn(async () => undefined)
    const result = await queryMarketDivergenceAsync({ asOf: '2026-10-30 12:00', read: reader({ stablecoin: spy }) })
    expect(result).toEqual({ state: 'unavailable', failureCode: 'market-divergence-query-unavailable', reason: 'invalid-clock', missing: [] })
    expect(spy).not.toHaveBeenCalled()
  })
})
