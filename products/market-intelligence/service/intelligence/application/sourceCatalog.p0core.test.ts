import { describe, expect, it } from 'vitest'

import { getIntelligenceSourceDefinition } from './sourceCatalog'

const P0_CORE_SOURCE_IDS = [
  'federal-reserve-rss',
  'sec-rss',
  'cftc-rss',
  'binance-announcements',
  'binance-api-updates',
  'okx-latest-announcements',
  'okx-api-announcements',
  'coinbase-status',
  'kraken-status',
  'kraken-system-status',
  'solana-status',
  'alternative-fear-greed',
  'defillama-stablecoins',
  'defillama-tvl',
  'binance-spot-market',
  'binance-futures-positioning'
] as const

describe('P0 core source catalog metadata', () => {
  it('lists all P0 core sources with expected readiness', () => {
    for (const sourceId of P0_CORE_SOURCE_IDS) {
      const definition = getIntelligenceSourceDefinition(sourceId)
      expect(definition, sourceId).toBeTruthy()
      expect(definition?.visibility).toBe('visible')
    }

    // OKX is lit: the help centre's own public JSON endpoint is read, so both announcement sources
    // collect without a credential and can be run now.
    expect(getIntelligenceSourceDefinition('okx-latest-announcements')?.readiness).toBe('live')
    expect(getIntelligenceSourceDefinition('okx-api-announcements')?.readiness).toBe('live')
    expect(getIntelligenceSourceDefinition('okx-latest-announcements')?.authMode).toBe('none')
    expect(getIntelligenceSourceDefinition('okx-api-announcements')?.supportsRunNow).toBe(true)
    // The two remaining zero-credential candidates stay unlit on purpose: Binance's asset page answers
    // with an empty challenge body, and the Treasury fiscal dataset moved away from the configured
    // `/accounting/od/` paths to the Daily Treasury Statement's `/accounting/dts/` ones.
    expect(getIntelligenceSourceDefinition('binance-asset-page')?.readiness).toBe('planned')
    expect(getIntelligenceSourceDefinition('treasury-fiscal-data')?.readiness).toBe('planned')

    for (const sourceId of [
      'federal-reserve-rss',
      'sec-rss',
      'cftc-rss',
      'binance-announcements',
      'coinbase-status',
      'alternative-fear-greed'
    ] as const) {
      expect(getIntelligenceSourceDefinition(sourceId)?.readiness ?? 'live').toBe('live')
    }
  })

  it('assigns parser strategies and classification metadata for text sources', () => {
    expect(getIntelligenceSourceDefinition('federal-reserve-rss')?.parserStrategy).toBe('fed-rss-v1')
    expect(getIntelligenceSourceDefinition('sec-rss')?.parserStrategy).toBe('regulator-rss-v1')
    expect(getIntelligenceSourceDefinition('cftc-rss')?.parserStrategy).toBe('regulator-rss-v1')
    expect(getIntelligenceSourceDefinition('sec-rss')?.dynamicClassification).toBe(true)
    expect(getIntelligenceSourceDefinition('binance-announcements')?.supportedImpactScopes).toContain('exchange')
  })

  it('assigns exchange and infrastructure metadata for status sources', () => {
    expect(getIntelligenceSourceDefinition('coinbase-status')?.intelligenceLayer).toBe('exchange')
    expect(getIntelligenceSourceDefinition('coinbase-status')?.reliabilityTier).toBe('official')
    expect(getIntelligenceSourceDefinition('kraken-system-status')?.intelligenceLayer).toBe('exchange')
    expect(getIntelligenceSourceDefinition('solana-status')?.intelligenceLayer).toBe('infrastructure')
  })

  it('keeps DeFiLlama stablecoins visible only as the dedicated capital collector', () => {
    const definition = getIntelligenceSourceDefinition('defillama-stablecoins')

    expect(definition).toMatchObject({
      parserStrategy: 'capital-conditions-stablecoins-v1',
      supportsSentiment: false,
      supportsReplay: false
    })
  })

  it('assigns instrument applicability to Binance spot and futures metric sources', () => {
    for (const sourceId of ['binance-spot-market', 'binance-futures-positioning'] as const) {
      const definition = getIntelligenceSourceDefinition(sourceId)
      expect(definition?.applicabilityMode).toBe('instrument')
      expect(definition?.venueScopes).toContain('binance')
      expect(definition?.instrumentScopes).toEqual(expect.arrayContaining(['ETHUSDT', 'BTCUSDT']))
    }
  })
})
