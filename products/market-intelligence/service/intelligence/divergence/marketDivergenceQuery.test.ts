import { describe, expect, it, vi } from 'vitest'

import { queryMarketDivergenceAsync, readSentimentLeg, type DivergenceLegReader } from './marketDivergenceQuery'

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
    sentiment: async () => ({ state: 'available', bearishSharePercent: 72, scoredCount: 11, observedAt: at(1) }),
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

  it('reports a throwing leg as a failed read, not as an empty market', async () => {
    const boom = vi.fn(async () => { throw new Error('leg down') })
    const result = await queryMarketDivergenceAsync({ asOf, read: reader({ sentiment: boom as never }) })
    expect(result.withheld).toContainEqual({ pairId: 'narrative-price', reason: 'leg-unavailable', leg: 'sentiment' })
  })

  it('reports an unwired sentiment reader as a failed read too', async () => {
    const result = await queryMarketDivergenceAsync({ asOf, read: reader({ sentiment: async () => ({ state: 'unavailable' }) }) })
    expect(result.withheld).toContainEqual({ pairId: 'narrative-price', reason: 'leg-unavailable', leg: 'sentiment' })
  })

  it('reports a day with nothing to score as a missing leg, not as a failed read', async () => {
    const result = await queryMarketDivergenceAsync({ asOf, read: reader({ sentiment: async () => ({ state: 'empty', reason: 'no-scored-items' }) }) })
    expect(result.withheld).toContainEqual({ pairId: 'narrative-price', reason: 'leg-missing', leg: 'sentiment' })
    expect(result.withheld.some(entry => entry.reason === 'leg-unavailable')).toBe(false)
  })

  it('keeps a zero bearish share as a reading: no headline was bearish, which is not an empty day', async () => {
    const reading = readSentimentLeg(view({ bearish: 0, directional: 12 }))
    expect(reading).toMatchObject({ state: 'available', bearishSharePercent: 0, scoredCount: 12 })
    const result = await queryMarketDivergenceAsync({ asOf, read: reader({ sentiment: async () => reading }) })
    expect(result.withheld.some(entry => entry.leg === 'sentiment')).toBe(false)
  })

  it('refuses to publish a share when no headline took a side', async () => {
    const reading = readSentimentLeg(view({ bearish: 0, directional: 0 }))
    expect(reading).toEqual({ state: 'empty', reason: 'no-scored-items' })
  })

  it('reports a window with no scored headline as a quiet day, not as a failed read', () => {
    expect(readSentimentLeg({ state: 'empty', asOf, generatedAt: asOf, window: '24h', items: [], availableSources: [], caveats: [] } as never))
      .toEqual({ state: 'empty', reason: 'no-scored-items' })
  })

  it('does not turn a view it cannot read into a quiet day', () => {
    expect(readSentimentLeg({ state: 'unavailable', asOf, generatedAt: asOf, window: '24h', items: [], caveats: [] } as never))
      .toEqual({ state: 'unavailable' })
  })

  it('refuses a non-canonical instant without reading a single leg', async () => {
    const spy = vi.fn(async () => undefined)
    const result = await queryMarketDivergenceAsync({ asOf: '2026-10-30 12:00', read: reader({ stablecoin: spy }) })
    expect(result).toEqual({ state: 'unavailable', failureCode: 'market-divergence-query-unavailable', reason: 'invalid-clock', missing: [] })
    expect(spy).not.toHaveBeenCalled()
  })
})

/** The narrowest view the leg reader accepts: enough to say how many headlines took which side. */
function view(input: Readonly<{ bearish: number; directional: number }>) {
  const item = (index: number, polarity: 'bearish' | 'bullish' | 'neutral') => ({
    itemId: `item-${polarity}-${index}`, title: `headline ${index}`, polarity, polarityScore: 0,
    strength: 1, confidence: 0.8, engine: 'rules', scoredAt: at(1), publishedAt: at(1),
    sourceId: 'wire', sourceCategory: 'crypto-media', sourceTrust: 'standard', caveats: [], bodyTranslationState: 'missing'
  })
  return {
    state: 'available', asOf, generatedAt: asOf, window: '24h',
    summary: { label: 'neutral', score: 0, itemCount: input.directional, directionalCount: input.directional, neutralCount: 0, sourceBreakdown: {}, engineMix: { model: 0, rules: input.directional }, lastScoredAt: at(1), latestItemAt: at(1) },
    items: [
      ...Array.from({ length: input.bearish }, (_, index) => item(index, 'bearish')),
      ...Array.from({ length: input.directional - input.bearish }, (_, index) => item(index, 'bullish'))
    ],
    availableSources: [{ sourceId: 'wire', sourceName: 'Wire' }], caveats: []
  }
}
