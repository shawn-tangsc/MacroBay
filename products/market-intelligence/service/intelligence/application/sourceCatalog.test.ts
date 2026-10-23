import { describe, expect, it } from 'vitest'

import { getIntelligenceSourceDefinition, isDefillamaStablecoinRetiredPath, listIntelligenceSourceDefinitions } from './sourceCatalog'
import { macroMarketPolicy } from '../macro-market/macroMarketPolicy'
import { realMarketApiPolicy } from '../macro-market/realMarketApiPolicy'
import { zeroXRouterSourcePolicy } from './zeroXRouterSourcePolicy'
import { V2_REQUIRED_LIVE_SOURCE_IDS } from './v2RequiredSources'

describe('sourceCatalog metadata', () => {
  it('lists required V2 live sources as visible and live', () => {
    for (const sourceId of V2_REQUIRED_LIVE_SOURCE_IDS) {
      const definition = getIntelligenceSourceDefinition(sourceId)
      expect(definition?.visibility).toBe('visible')
      expect(definition?.readiness ?? 'live').toBe('live')
    }
  })

  it('assigns layered metadata to macro and metric sources', () => {
    const fearGreed = getIntelligenceSourceDefinition('alternative-fear-greed')
    expect(fearGreed?.intelligenceLayer).toBe('industry')
    expect(fearGreed?.eventFamily).toBe('metric-event')
    expect(fearGreed?.reliabilityTier).toBe('aggregator')
    expect(fearGreed?.supportedImpactScopes).toContain('crypto-market')
  })

  it('keeps BLS fixture-ready and blocks production run now', () => {
    const bls = getIntelligenceSourceDefinition('bls-economic-series')
    expect(bls?.visibility).toBe('visible')
    expect(bls?.readiness).toBe('fixture-ready')
    expect(bls?.supportsRunNow).toBe(false)
    expect(bls?.authMode).toBe('optional-api-key')
    expect(bls?.supportsCredentialTest).toBe(true)
    expect(bls?.adapterConfig.requestMode).toBe('bls-series')
    expect(bls?.adapterConfig.freshnessWindowMs).toBeGreaterThan(0)
    expect(Array.isArray(bls?.adapterConfig.series)).toBe(true)
  })

  it('treats fred-rates-liquidity as the canonical, configurable FRED macro source', () => {
    const fred = getIntelligenceSourceDefinition('fred-rates-liquidity')
    expect(fred?.visibility).toBe('visible')
    // Configurable: the reader enables it and pastes a key; the credential is what admits the job.
    expect(fred?.readiness).toBe('live')
    expect(fred?.authMode).toBe('api-key')
    expect(fred?.supportsCredentialTest).toBe(true)
    expect(fred?.adapterConfig.requestMode).toBe('fred-series')
    expect((fred?.adapterConfig.series as Array<{ key: string }>)?.map((row) => row.key)).toContain('US_2Y_YIELD')
    expect((fred?.adapterConfig.series as Array<{ key: string }>)?.map((row) => row.key)).toContain('US_10Y_BREAKEVEN_INFLATION')
  })

  it('hides legacy fred from runnable catalog paths', () => {
    const legacy = getIntelligenceSourceDefinition('fred')
    expect(legacy?.visibility).toBe('hidden')
    expect(legacy?.supportsRunNow).toBe(false)
    expect(legacy?.supportsCredentialTest).toBe(false)
  })

  it('lists planned macro sources without hiding them', () => {
    const bea = getIntelligenceSourceDefinition('bea-economic-series')
    expect(bea?.visibility).toBe('visible')
    expect(bea?.readiness).toBe('planned')
    expect(bea?.readinessNote).toBeTruthy()
  })

  it('registers 0xRouter as a default-disabled governed ETF current-state source without generic Run Now', () => {
    const source = getIntelligenceSourceDefinition('0xrouter-aggregate-provider')
    expect(source).toMatchObject({
      sourceId: '0xrouter-aggregate-provider', sourceGroup: 'aggregate-data-provider', authMode: 'api-key',
      supportsCredentialTest: true, supportsRunNow: false, readiness: 'live', defaultCollectionPreset: 'balanced',
      adapterConfig: { probeContract: 'account-balance-json-object' },
      requestGovernance: {
        providerId: '0xrouter', quotaScope: 'api-key',
        rollingWindow: { maxRequests: 10, windowMs: 60_000 },
        queue: { ordering: 'fifo', maxPending: 10, maxWaitMs: 60_000 }, settingVisibility: 'visible'
      }
    })
    expect(zeroXRouterSourcePolicy.connectionProbe).toMatchObject({
      method: 'GET', requestHeader: 'X-My-Token', contract: 'account-balance-json-object',
      url: 'https://0xrouter.app/account/balance'
    })
    expect(zeroXRouterSourcePolicy.etfData).toMatchObject({
      contract: 'cexdata-etf-net-assets-history',
      url: 'https://0xrouter.app/cexdata/etf/bitcoin/net-assets/history/'
    })
  })

  it('registers the real ICE dollar index as a product-owned credentialed source', () => {
    const dxy = getIntelligenceSourceDefinition('realmarketapi-market')
    expect(dxy).toMatchObject({
      sourceId: 'realmarketapi-market',
      sourceGroup: 'macro-regulation',
      adapterType: 'rest-api-poller',
      authMode: 'api-key',
      supportsCredentialTest: true,
      // The generic runtime must never collect it: the product's own five-minute job owns the cadence
      // and the monthly budget, exactly as it does for the basket that remains the fallback.
      supportsRunNow: false,
      collectionOwner: 'product',
      // `manual` is what makes `live` safe: the generic adapter runtime turns any other preset into a
      // schedule, and there is no `realmarketapi-dxy-v1` adapter for it to call.
      defaultCollectionPreset: 'manual',
      // Live, not planned: readiness is what lets this source's key be saved at all.
      readiness: 'live'
    })
    expect(dxy?.adapterConfig).toMatchObject({
      symbolCode: 'DXY', latestTimeFrame: 'M5', backfillTimeFrame: 'M15', backfillLimit: 100
    })
    expect(dxy?.adapterConfig.seriesId).toBe(realMarketApiPolicy.series.dollarIndex)
    expect(dxy?.adapterConfig.seriesId).toBe(macroMarketPolicy.series.dollarIndexReal)
  })

  it('ranks exchange-api reliability above page extraction', () => {
    const spot = getIntelligenceSourceDefinition('binance-spot-market')
    const announcements = getIntelligenceSourceDefinition('binance-announcements')
    expect(spot?.reliabilityTier).toBe('exchange-api')
    expect(announcements?.reliabilityTier).toBe('page-extract')
  })

  it('exposes metadata for every catalog source', () => {
    for (const source of listIntelligenceSourceDefinitions()) {
      expect(source.intelligenceLayer).toBeTruthy()
      expect(source.dataDomain).toBeTruthy()
      expect(source.reliabilityTier).toBeTruthy()
      expect(source.eventFamily).toBeTruthy()
      if (isDefillamaStablecoinRetiredPath(source.sourceId)) {
        expect(source.supportedImpactScopes).toEqual([])
      } else {
        expect(source.supportedImpactScopes?.length).toBeGreaterThan(0)
      }
      expect(source.sourceKind).toBeTruthy()
      expect(source.applicabilityMode).toBeTruthy()
      expect(source.focusMarkets.length).toBeGreaterThan(0)
    }
  })

  it('assigns explicit applicability to every visible source', () => {
    const seeds = new Set(
      listIntelligenceSourceDefinitions()
        .filter((source) => source.visibility !== 'hidden')
        .map((source) => source.sourceId)
    )
    expect(seeds.size).toBeGreaterThan(0)
    for (const sourceId of seeds) {
      const definition = getIntelligenceSourceDefinition(sourceId)
      expect(definition?.sourceKind).toBeTruthy()
      expect(definition?.applicabilityMode).toBeTruthy()
      expect(definition?.focusMarkets.length).toBeGreaterThan(0)
    }
  })
})
