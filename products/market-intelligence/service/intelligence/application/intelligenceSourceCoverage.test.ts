import { describe, expect, it } from 'vitest'

import { buildSourceCoverage } from './intelligenceSourceCoverage'
import { createIntelligencePipeline } from './intelligencePipeline'
import { createInMemoryProfileStorage, createSourceProfileStore } from './sourceProfileStore'
import { createDefaultSourceProfile } from './sourceRuntimeConfig'
import { getIntelligenceSourceDefinition } from './sourceCatalog'

describe('intelligenceSourceCoverage', () => {
  it('marks planned and fixture-only sources without treating them as fresh live coverage', () => {
    const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
    const pipeline = createIntelligencePipeline({ profileStore })
    const blsDefinition = getIntelligenceSourceDefinition('bls-economic-series')!
    const beaDefinition = getIntelligenceSourceDefinition('bea-economic-series')!

    const coverage = buildSourceCoverage({
      profileById: new Map([
        ['bls-economic-series', createDefaultSourceProfile(blsDefinition)],
        ['bea-economic-series', createDefaultSourceProfile(beaDefinition)]
      ]),
      pipeline
    })

    expect(coverage.find((row) => row.sourceId === 'bls-economic-series')?.productionState).toBe('fixture-only')
    expect(coverage.find((row) => row.sourceId === 'bea-economic-series')?.productionState).toBe('planned')
    expect(coverage.find((row) => row.sourceId === 'alternative-fear-greed')?.v2Required).toBe(true)
  })

  it('marks enabled live sources as pending before first success', () => {
    const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
    const pipeline = createIntelligencePipeline({ profileStore })
    const fearGreedDefinition = getIntelligenceSourceDefinition('alternative-fear-greed')!

    const coverage = buildSourceCoverage({
      profileById: new Map([
        [
          'alternative-fear-greed',
          { ...createDefaultSourceProfile(fearGreedDefinition), enabled: true }
        ]
      ]),
      pipeline
    })

    expect(coverage.find((row) => row.sourceId === 'alternative-fear-greed')?.productionState).toBe('pending')
  })

  it('filters digital-asset-only sources when digital-assets focus is disabled', () => {
    const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
    const pipeline = createIntelligencePipeline({ profileStore })

    const coverage = buildSourceCoverage({
      profileById: new Map(),
      pipeline,
      enabledFocusMarkets: ['global-macro']
    })

    expect(coverage.some((row) => row.sourceId === 'federal-reserve-rss')).toBe(true)
    expect(coverage.some((row) => row.sourceId === 'binance-announcements')).toBe(false)
    expect(coverage.every((row) => row.focusMarketActive)).toBe(true)
  })

  it('does not project retired DeFiLlama stablecoins through generic pipeline coverage', () => {
    const pipeline = createIntelligencePipeline()
    const coverage = buildSourceCoverage({
      profileById: new Map(),
      pipeline,
      enabledFocusMarkets: ['digital-assets']
    })

    expect(coverage.some((row) => row.sourceId === 'defillama-stablecoins')).toBe(false)
    expect(coverage.some((row) => row.sourceId === 'defillama-tvl')).toBe(true)
  })
})
