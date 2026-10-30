import { describe, expect, it } from 'vitest'

import type { JobRuntime } from '@platform/jobs'

import { marketIntelligenceProductManifest } from '../../../product.manifest'
import { intelligenceAgentCapabilities } from '../agent-capabilities/capabilityCatalog'
import {
  MARKET_ANALYSIS_CONTEXT_POLICY,
  MARKET_ANALYSIS_CROSS_ASSET_INSTRUMENTS,
  formatMarketAnalysisDataAccessAcceptanceMarker
} from '../../../contracts/marketAnalysisContracts'
import { MARKET_INTELLIGENCE_QUERY_CAVEATS } from '../../../contracts/intelligenceQueryContracts'
import { macroRatesSnapshotPublicPolicy } from '../../../contracts/macro/macroRatesSnapshotContracts'
import { macroMarketSnapshotPublicPolicy } from '../../../contracts/macro/macroMarketSnapshotContracts'
import type { MacroMarketSnapshot } from '../../macro-market/macroMarketSnapshotQuery'
import type { MacroRatesSnapshot } from '../../macro-rates/macroRatesSnapshotQuery'
import {
  buildMarketAnalysisDomainAccessMatrix,
  buildMarketAnalysisContext,
  compareMarketAnalysisAgentToolRegistration,
  formatMarketAnalysisContextAcceptanceMarker,
  formatMarketAnalysisDataAccessHarness,
  listMarketAnalysisSourceAccess,
  resolveMacroActual,
  type MarketAnalysisDomainObservation
} from './marketAnalysisContextQuery'
import { registerIntelligenceAgentToolHandlers } from '../agent-capabilities/handlerRegistry'
import {
  marketCalendarPublicPolicy,
  type MarketCalendarEvent,
  type MarketCalendarPage
} from '../../../contracts/macro/marketCalendarQueryContracts'
import type { MacroEconomicCalendarEventView } from '../../../contracts/macro/economicCalendarQueryContracts'

const AS_OF = '2026-09-25T08:30:00.000Z'

const SERIES = macroMarketSnapshotPublicPolicy.series

/** A dollar/gold reading shaped like the one `createMacroMarketSnapshotQuery` returns. */
function macroMarketReading(seriesId: string, overrides: Partial<{ level: number; atMs: number; synthetic: true }> = {}) {
  return {
    seriesId,
    level: seriesId === SERIES.gold ? 4100.5 : 102.24,
    // The synthesis is the series this product computes; the licensed index is `dxy-real`.
    ...(seriesId === SERIES.dollarIndex ? { synthetic: true as const, level: 101.42 } : {}),
    atMs: Date.parse(AS_OF),
    returns: { '15m': 0.1, '1h': 0.2, '24h': 0.4, '7d': 0.3 },
    ...overrides
  }
}

function macroMarketSnapshot(overrides: Partial<Extract<MacroMarketSnapshot, { state: 'available' | 'empty' }>> = {}): MacroMarketSnapshot {
  const readings = overrides.readings ?? [macroMarketReading(SERIES.dollarIndexReal), macroMarketReading(SERIES.gold)]
  return { state: readings.length > 0 ? 'available' : 'empty', asOf: AS_OF, readings, caveats: [], ...overrides, readings }
}

/** The four FRED series the daily block renders, on one trading day. */
function macroRatesSnapshot(): MacroRatesSnapshot {
  return {
    state: 'available', asOf: AS_OF, caveats: ['official-daily-close'],
    readings: [
      { seriesId: SERIES_RATES.us10y, metricKey: 'US_10Y_YIELD', actual: 4.15, previous: 4.13, period: '2026-09-24' },
      { seriesId: SERIES_RATES.realRate, metricKey: 'US_REAL_YIELD_10Y', actual: 1.85, previous: 1.82, period: '2026-09-24' },
      { seriesId: SERIES_RATES.us2y, metricKey: 'US_2Y_YIELD', actual: 4.0, period: '2026-09-24' },
      { seriesId: SERIES_RATES.breakevenInflation, metricKey: 'US_10Y_BREAKEVEN_INFLATION', actual: 2.3, period: '2026-09-24' }
    ]
  }
}

const SERIES_RATES = macroRatesSnapshotPublicPolicy.series

function queryEnvelope(data: unknown, queryType = 'query_sentiment_snapshot') {
  return {
    schemaVersion: 1, queryId: 'query-1', queryType, asOf: AS_OF, servedAt: AS_OF,
    resultHash: 'hash', scope: {}, timeWindow: { to: AS_OF }, confidence: 1,
    caveats: [], sourceCoverage: [], evidenceRefs: [], data
  }
}

const MARKET_OBSERVATION_KEY = JSON.stringify(['0xrouter', 'macro-calendar-0xrouter-economic-data', 'zh', JSON.stringify(['211664', 71565])])

function marketEvent(overrides: Partial<MarketCalendarEvent> = {}): MarketCalendarEvent {
  return {
    eventKey: '11111111-2222-3333-4444-555555555555', observationKey: MARKET_OBSERVATION_KEY,
    title: '美国核心CPI年率', countryCode: 'US', eventType: 'economic-indicator', importance: 'high',
    scheduledAt: '2026-09-10T12:30:00.000Z', consensus: { displayValue: '3.1' }, providerPrevious: { displayValue: '3.0' },
    providerActual: { displayValue: '3.2' }, source: '0xRouter', sourceObservedAt: '2026-09-10T12:31:00.000Z',
    coverage: 'observed-unverified', ...overrides
  }
}

function marketPage(events: readonly MarketCalendarEvent[]): MarketCalendarPage {
  return { state: 'available', month: '2026-09', locale: 'zh', asOf: AS_OF, events,
    sources: marketCalendarPublicPolicy.kinds.map(eventType => ({ eventType, status: 'success',
      sourceObservedAt: '2026-09-10T00:00:00.000Z' })) }
}

function officialEvent(): MacroEconomicCalendarEventView {
  return {
    eventKey: 'US.CPI.2026-09-25', releaseGroupKey: 'US.BLS.CPI.2026-09', eventFamily: 'consumer-price-index',
    titleKey: 'cpi', countryCode: 'US', importance: 'high', periodKey: '2026-08', lifecycleState: 'released',
    coverage: 'available', scheduledDate: '2026-09-25', scheduledAt: AS_OF, detectedAt: AS_OF,
    actual: { displayValue: '3.2%', unit: 'percent-yoy' }, consensus: null,
    consensusState: 'unavailable', surprise: 'consensus-unavailable', providerIds: ['macro-calendar-bls'], caveats: []
  }
}

function contextQueryService(overrides: Record<string, unknown> = {}) {
  return {
    querySentimentSnapshot: async () => queryEnvelope({ status: 'unknown', scopeType: 'asset', scopeKey: 'BTC', horizon: '1h', supportingImpactCount: 0, supportingItemCount: 0, supportingClusterCount: 0 }),
    querySentimentSeries: async () => queryEnvelope({ points: [] }, 'query_sentiment_series'),
    queryRelatedEvents: async () => queryEnvelope({ events: [] }, 'query_related_events'),
    queryImpactTimeline: async () => queryEnvelope({ impacts: [] }, 'query_impact_timeline'),
    getSourceHealth: async () => queryEnvelope({ sources: [] }, 'get_source_health'),
    getEvidenceExcerpt: async () => queryEnvelope({}, 'get_evidence_excerpt'),
    queryFearGreedSnapshot: async () => ({ state: 'available', asOf: AS_OF, score: 42, bucket: 'fear', observedAt: AS_OF }),
    queryFundingRateHistory: async () => ({ state: 'available', asOf: AS_OF, btc: [{ observedAt: AS_OF, ratePercent: 0.01 }], eth: [{ observedAt: AS_OF, ratePercent: -0.02 }] }),
    queryCapitalConditionsSnapshot: async () => ({
      state: 'available', asOf: AS_OF, etf: { state: 'unavailable' },
      coreStablecoins: { observedAt: AS_OF, verifiedAt: AS_OF, currentUsd: 100, change1dUsd: 1, change1dPercent: 1, change7dUsd: 2, change7dPercent: 2, change30dUsd: 3, change30dPercent: 3 },
      conclusion: 'partial'
    }),
    ...overrides
  }
}

describe('market analysis data-access matrix', () => {
  it('projects the five specialized domains with truthful three-layer access', () => {
    const result = buildMarketAnalysisDomainAccessMatrix({ asOf: AS_OF })

    expect(result.domains).toHaveLength(5)
    expect(result.domains).toEqual(expect.arrayContaining([
      expect.objectContaining({
        domain: 'sentiment', sourceIds: ['alternative-fear-greed'],
        admission: 'connected-but-not-agent-tool',
        publicQueryMethods: ['publicQueryService.queryFearGreedSnapshot'],
        ipcMethods: ['intelligence.queryFearGreedSnapshot'],
        agentToolAvailable: false, autoTriggerAllowed: false,
        queryState: 'missing', freshness: 'missing', asOf: AS_OF, factCount: 0, evidenceCount: 0
      }),
      expect.objectContaining({
        domain: 'funding', sourceIds: ['binance-futures-positioning'],
        admission: 'connected-but-not-agent-tool',
        publicQueryMethods: ['publicQueryService.queryFundingRateHistory'],
        ipcMethods: ['intelligence.queryFundingRateHistory'],
        agentToolAvailable: false
      }),
      expect.objectContaining({
        domain: 'capital', sourceIds: ['defillama-stablecoins', '0xrouter'],
        admission: 'connected-but-not-agent-tool',
        publicQueryMethods: ['publicQueryService.queryCapitalConditionsSnapshot'],
        ipcMethods: ['intelligence.queryCapitalConditionsSnapshot'],
        agentToolAvailable: false
      }),
      expect.objectContaining({
        domain: 'cross-asset', sourceIds: ['realmarketapi-market', 'binance-futures-positioning'],
        admission: 'connected-but-not-agent-tool',
        // The analysis reads the same snapshot the panel does; `ipcMethods` stays the panel's route.
        publicQueryMethods: ['publicQueryService.queryCrossAssetSnapshot'],
        ipcMethods: ['intelligence.crossAsset.query'], agentToolAvailable: false,
        queryState: 'not-comparable'
      }),
      expect.objectContaining({
        domain: 'macro',
        admission: 'connected-but-not-agent-tool',
        // The macro domain now carries two read-only agent tools (the dollar/gold snapshot and the
        // FRED daily block), so its tool flag is derived from the source registry rather than false.
        agentToolAvailable: true,
        sourceIds: expect.arrayContaining(['fred-rates-liquidity', 'twelve-data-market']),
        publicQueryMethods: [
          'macroEconomicCalendarQueryService.queryMonth',
          'marketCalendarPublicQueryService.queryMonth',
          'publicQueryService.queryMacroMarketSnapshot',
          'publicQueryService.queryMacroRatesSnapshot'
        ],
        ipcMethods: [
          'intelligence.macro.economicCalendar.queryMonth',
          'intelligence.macro.marketCalendar.queryMonth',
          'intelligence.macro.marketSnapshot.query',
          'intelligence.macro.ratesSnapshot.query'
        ]
      })
    ]))
    // Nothing is blocked any more: the dollar and gold now arrive through the admitted macro-market
    // source, and the dollar's synthetic construction is declared as a caveat on that source (asserted
    // with the per-source decisions below) rather than as a lower admission.
    expect(result.blockedSources).toEqual([])
    expect(result.instrumentIdentities).toEqual([...MARKET_ANALYSIS_CROSS_ASSET_INSTRUMENTS])
  })

  it('keeps the six admission decisions at source granularity', () => {
    const access = listMarketAnalysisSourceAccess()

    expect(access).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'macro-calendar-fed-schedule', admission: 'production-ready', agentToolAvailable: false, autoTriggerAllowed: true }),
      expect.objectContaining({ sourceId: 'macro-calendar-fed-statement', admission: 'production-ready', agentToolAvailable: false, autoTriggerAllowed: true }),
      expect.objectContaining({ sourceId: 'macro-calendar-fed-statement-history', admission: 'production-ready', agentToolAvailable: false, autoTriggerAllowed: true }),
      expect.objectContaining({ sourceId: 'macro-calendar-bls-schedule', admission: 'connected-but-not-agent-tool', agentToolAvailable: false }),
      expect.objectContaining({ sourceId: 'macro-calendar-bls-values', admission: 'connected-but-not-agent-tool', agentToolAvailable: false }),
      expect.objectContaining({ sourceId: 'macro-calendar-bls-ics-manual', admission: 'connected-but-not-agent-tool', agentToolAvailable: false }),
      expect.objectContaining({ sourceId: 'macro-calendar-bea-schedule', admission: 'production-ready', agentToolAvailable: false, autoTriggerAllowed: true }),
      expect.objectContaining({ sourceId: 'macro-calendar-bea-release-rss', admission: 'production-ready', agentToolAvailable: false, autoTriggerAllowed: true }),
      expect.objectContaining({ sourceId: 'alternative-fear-greed', admission: 'connected-but-not-agent-tool', agentToolAvailable: false }),
      expect.objectContaining({ sourceId: 'binance-futures-positioning', admission: 'connected-but-not-agent-tool', agentToolAvailable: false }),
      expect.objectContaining({ sourceId: 'defillama-stablecoins', admission: 'connected-but-not-agent-tool', agentToolAvailable: false }),
      expect.objectContaining({ sourceId: '0xrouter', admission: 'connected-but-not-agent-tool', agentToolAvailable: false }),
      // Full admission with the official calendar: the unverified identity is carried as a
      // caveat, not as a lower admission, and these sources may trigger analysis.
      expect.objectContaining({ sourceId: 'macro-calendar-0xrouter-economic-data', admission: 'production-ready', autoTriggerAllowed: true, caveats: ['observed-unverified'] }),
      expect.objectContaining({ sourceId: 'macro-calendar-0xrouter-financial-events', admission: 'production-ready', autoTriggerAllowed: true, caveats: ['observed-unverified'] }),
      expect.objectContaining({ sourceId: 'macro-calendar-0xrouter-central-bank-activities', admission: 'production-ready', autoTriggerAllowed: true, caveats: ['observed-unverified'] }),
      expect.objectContaining({ sourceId: 'bea-economic-series', admission: 'planned', autoTriggerAllowed: false }),
      // FRED is connected and read by the dashboard's daily rate rows, but its granularity is a
      // trading-day close: the caveat rides with the source so no conclusion reads it as intraday.
      expect.objectContaining({
        sourceId: 'fred-rates-liquidity', admission: 'connected-but-not-agent-tool', autoTriggerAllowed: false,
        publicQueryMethods: ['macroRatesSnapshotQuery.snapshot'], ipcMethods: ['intelligence.macro.ratesSnapshot.query'],
        caveats: ['official-daily-close'],
        // Promoted to a read-only agent tool; still barred from starting an analysis.
        agentToolAvailable: true
      }),
      expect.objectContaining({
        sourceId: 'twelve-data-market', admission: 'production-ready', autoTriggerAllowed: false,
        caveats: expect.arrayContaining(['synthetic-dollar-index', 'provider-time-series']),
        agentToolAvailable: true
      })
    ]))
    expect(access.some(item => item.admission === 'temporarily-paused')).toBe(false)
  })

  it('keeps the analysis caveat vocabulary and the rates wire contract naming one caveat', () => {
    // The analysis says `official-daily-close`; the wire publishes the same id. Drift between the two
    // would let the model read a daily series as if the panel had told it the granularity.
    expect(MARKET_INTELLIGENCE_QUERY_CAVEATS.officialDailyClose).toBe(macroRatesSnapshotPublicPolicy.caveats.officialDailyClose)
  })

  it.each([
    ['available', 'fresh'], ['empty', 'missing'], ['stale', 'stale'],
    ['unavailable', 'unavailable'], ['missing', 'missing'], ['not-comparable', 'closed']
  ] as const)('preserves %s as a runtime query state instead of inventing a value', (queryState, freshness) => {
    const observation: MarketAnalysisDomainObservation = { queryState, freshness, factCount: 0, evidenceCount: 0, caveats: [] }
    const result = buildMarketAnalysisDomainAccessMatrix({ asOf: AS_OF, observations: { funding: observation } })
    const funding = result.domains.find(domain => domain.domain === 'funding')!

    expect(funding.queryState).toBe(queryState)
    expect(funding.freshness).toBe(freshness)
    expect(funding.factCount).toBe(0)
    expect(funding.evidenceCount).toBe(0)
  })

  it('keeps the unverified 0xRouter actual separate and lets official actual win', () => {
    expect(resolveMacroActual({ official: { value: '2.1', observedAt: AS_OF }, provider: { value: '9.9', observedAt: AS_OF } }))
      .toEqual({ value: '2.1', source: 'official' })
    expect(resolveMacroActual({ official: null, provider: { value: '9.9', observedAt: AS_OF } }))
      .toEqual({ value: '9.9', source: 'observed-unverified' })
    expect(resolveMacroActual({ official: null, provider: null })).toEqual({ value: null, source: null })
  })

  it('does not mark stale capital/ETF data as confirmation of a recent event', () => {
    const result = buildMarketAnalysisDomainAccessMatrix({
      asOf: AS_OF,
      observations: {
        capital: { queryState: 'stale', freshness: 'stale', factCount: 2, evidenceCount: 2, caveats: ['stale-etf-cannot-confirm-recent-event'] }
      }
    })
    const capital = result.domains.find(domain => domain.domain === 'capital')!
    expect(capital.queryState).toBe('stale')
    expect(capital.caveats).toContain('stale-etf-cannot-confirm-recent-event')
    expect(capital.autoTriggerAllowed).toBe(false)
  })

  it('derives the manifest tools from the capability catalog and registers a handler for each', () => {
    const manifestToolNames = marketIntelligenceProductManifest.productAgentTools.map(tool => tool.toolName)
    const handlerIds: string[] = []
    registerIntelligenceAgentToolHandlers((registration) => handlerIds.push(registration.handlerId), {
      jobRuntime: {} as JobRuntime,
      macroCalendarOps: {} as never,
      crossAssetOps: {} as never
    })

    expect(manifestToolNames).toEqual(intelligenceAgentCapabilities.map(capability => capability.id))
    expect(manifestToolNames).toContain('get_market_analysis_context')
    expect(manifestToolNames).toEqual(expect.arrayContaining(['get_macro_market_snapshot', 'get_macro_rates_snapshot', 'get_policy_path', 'explain_figure']))
    expect(marketIntelligenceProductManifest.tools.map(tool => tool.id)).toEqual([
      'get_market_analysis_context', 'get_macro_market_snapshot', 'get_macro_rates_snapshot', 'get_policy_path', 'explain_figure'
    ])
    expect(marketIntelligenceProductManifest.skills.map(skill => skill.id)).toEqual([
      'market-analysis-skill-v1', 'daily-brief-editor-skill-v1', 'intelligence-ops-skill-v1'
    ])
    // Two seeded agents: the analyst that answers questions, and the brief editor that only curates
    // a draft. The editor intentionally has no tools or workflows of its own.
    expect(marketIntelligenceProductManifest.agents).toEqual([
      expect.objectContaining({
        id: 'crypto-market-analyst',
        toolIds: ['get_market_analysis_context', 'get_macro_market_snapshot', 'get_macro_rates_snapshot', 'get_policy_path', 'explain_figure'],
        skillIds: ['market-analysis-skill-v1', 'intelligence-ops-skill-v1'],
        workflowIds: ['market-analysis-auto-run-v1']
      }),
      expect.objectContaining({
        id: 'daily-brief-editor',
        toolIds: [],
        skillIds: ['daily-brief-editor-skill-v1'],
        workflowIds: []
      })
    ])
    expect(marketIntelligenceProductManifest.workflows.map(workflow => workflow.id)).toEqual(['market-analysis-auto-run-v1'])
    expect(compareMarketAnalysisAgentToolRegistration(manifestToolNames, handlerIds)).toEqual({
      registeredToolCount: intelligenceAgentCapabilities.length,
      mismatchCount: 0
    })
  })

  it('names the macro limitations in the tool descriptions the model reads', () => {
    const tools = marketIntelligenceProductManifest.productAgentTools ?? []
    const market = tools.find(tool => tool.toolName === 'get_macro_market_snapshot')
    const rates = tools.find(tool => tool.toolName === 'get_macro_rates_snapshot')

    // A model that never opens the admission matrix must still learn the limits from the tool itself.
    expect(market?.description).toContain('synthetic-dollar-index')
    expect(market?.description).toContain('dxy-synthetic')
    expect(market?.description).toContain('15m/1h/4h/24h')
    expect(rates?.description).toContain('official-daily-close')
    expect(rates?.description).toContain('日频')
    expect(rates?.description).toContain('休市')
    expect(rates?.description).toContain('滞后')
    for (const tool of [market, rates]) {
      expect(tool).toMatchObject({ readOnly: true, requiresTemporalBoundary: false })
      expect(JSON.stringify(tool)).not.toMatch(/https?:\/\/|apikey|api[_-]?key/i)
    }
  })

  it('prints only the safe MI-A03A acceptance marker', () => {
    const marker = formatMarketAnalysisDataAccessAcceptanceMarker({
      domains: 5, runtimeStatusCasesCovered: 6, agentToolsRegistered: 6, agentToolMismatch: 0
    })
    console.log(marker)
    expect(marker).toBe('{"marker":"MI_ANALYSIS_ACCEPTANCE","package":"MI-A03A","event":"data-access-matrix","status":"pass","details":{"domains":5,"runtimeStatusCasesCovered":6,"agentToolsRegistered":6,"agentToolMismatch":0}}')
    expect(marker).not.toMatch(/https?:\/\/|\/Users\/|api[_-]?key|token|prompt|raw/i)
  })

  it('prints a renderer-safe data-access harness without provider or local details', () => {
    const harness = formatMarketAnalysisDataAccessHarness(buildMarketAnalysisDomainAccessMatrix({ asOf: AS_OF }))
    console.log(harness)

    expect(JSON.parse(harness)).toMatchObject({
      asOf: AS_OF,
      domains: expect.arrayContaining([
        expect.objectContaining({ domain: 'macro', agentToolAvailable: true, factCount: 0, evidenceCount: 0 }),
        expect.objectContaining({ domain: 'capital', agentToolAvailable: false })
      ])
    })
    expect(JSON.parse(harness).sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'twelve-data-market', admission: 'production-ready', agentToolAvailable: true, caveats: expect.arrayContaining(['synthetic-dollar-index']) }),
      expect.objectContaining({ sourceId: 'fred-rates-liquidity', agentToolAvailable: true, caveats: ['official-daily-close'] }),
      expect.objectContaining({ sourceId: 'macro-calendar-0xrouter-economic-data', admission: 'production-ready', autoTriggerAllowed: true })
    ]))
    expect(harness).not.toMatch(/https?:\/\/|\/Users\/|api[_-]?key|token|prompt|raw|error/i)
  })

  it('rejects a missing or non-canonical asOf before querying any domain', async () => {
    const service = contextQueryService()
    const result = await buildMarketAnalysisContext({
      eventGroupId: 'mi-eg-test', asOf: '2026-09-25T08:30:00Z'
    }, service)

    expect(result).toEqual({ state: 'unavailable', errorCode: 'analysis-as-of-invalid' })
  })

  it('rejects future and symbol-bearing input without exposing the thrown detail', async () => {
    const service = contextQueryService()
    await expect(buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: '2999-09-25T08:30:00.000Z' }, service)).resolves.toEqual({ state: 'unavailable', errorCode: 'analysis-as-of-invalid' })
    const hostile = { eventGroupId: 'mi-eg-test', asOf: AS_OF, [Symbol('secret')]: 'private' } as never
    await expect(buildMarketAnalysisContext(hostile, service)).resolves.toEqual({ state: 'unavailable', errorCode: 'analysis-as-of-invalid' })
  })

  it('reads the cross-asset snapshot and clears the domain once it carries comparable price evidence', async () => {
    const wired = await buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF },
      contextQueryService({ queryCrossAssetSnapshot: async ({ range }: { range: '1h' | '24h' | '7d' }) => crossAssetSnapshotFor(range) }) as never)

    expect(wired.state).toBe('available')
    if (wired.state !== 'available') return
    // The two "数据限制" entries the reader reported trace back to this domain being missing.
    expect(wired.missingDomains).not.toContain('cross-asset')
    const prices = wired.facts.filter(fact => fact.domain === 'cross-asset' && fact.metric.startsWith('price-return'))
    expect(prices.length).toBeGreaterThan(0)
    expect(prices.some(fact => fact.comparability === 'comparable')).toBe(true)
    expect(wired.facts.some(fact => fact.domain === 'cross-asset' && fact.metric === 'relative-return-2h' && fact.comparability === 'comparable')).toBe(true)

    // Not wired: the domain stays exactly as unhelpful as it is today, rather than crashing.
    const bare = await buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF }, contextQueryService() as never)
    expect(bare.state === 'available' && bare.missingDomains).toContain('cross-asset')
  })

  it('rejects an invalid maxFacts value instead of silently restoring the default', async () => {
    await expect(buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF, maxFacts: 0 }, contextQueryService()))
      .resolves.toEqual({ state: 'unavailable', errorCode: 'analysis-context-max-facts-invalid' })
    await expect(buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF, maxFacts: 1.5 }, contextQueryService()))
      .resolves.toEqual({ state: 'unavailable', errorCode: 'analysis-context-max-facts-invalid' })
  })

  it('turns hostile query projections into a safe unavailable domain without throwing', async () => {
    const hostileService = contextQueryService({
      queryFundingRateHistory: async () => new Proxy({}, { get() { throw new Error('https://secret.example.test/raw') } })
    })
    const result = await buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF }, hostileService)

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    expect(result.domainAccess.find(domain => domain.domain === 'funding')).toMatchObject({ queryState: 'unavailable', freshness: 'unavailable' })
    expect(JSON.stringify(result)).not.toMatch(/https?:\/\/|secret|raw/i)
  })

  it('contains hostile getters inside a domain projection', async () => {
    const hostile = { state: 'available' as const } as Record<string, unknown>
    Object.defineProperty(hostile, 'btc', { get: () => { throw new Error('provider payload') } })
    Object.defineProperty(hostile, 'eth', { get: () => { throw new Error('provider payload') } })
    const result = await buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF }, contextQueryService({
      queryFundingRateHistory: async () => hostile
    }))

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    expect(result.domainAccess.find(domain => domain.domain === 'funding')).toMatchObject({ queryState: 'unavailable', freshness: 'unavailable' })
    expect(JSON.stringify(result)).not.toContain('provider payload')
  })

  it('maps pending and unknown source health to degraded instead of healthy', async () => {
    const result = await buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF }, contextQueryService({
      getSourceHealth: async () => queryEnvelope({ sources: [
        { sourceId: 'pending-source', productionState: 'pending', confidence: 0.2, caveats: [] },
        { sourceId: 'unknown-source', productionState: 'unknown', confidence: 0.2, caveats: [] },
        { sourceId: 'fixture-source', productionState: 'fixture-only', confidence: 0.2, caveats: [] },
        { sourceId: 'fresh-source', productionState: 'fresh', confidence: 0.9, caveats: [] }
      ] }, 'get_source_health')
    }))

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    expect(result.sourceHealth).toEqual(expect.arrayContaining([
      { sourceId: 'pending-source', status: 'degraded', asOf: AS_OF },
      { sourceId: 'unknown-source', status: 'degraded', asOf: AS_OF },
      { sourceId: 'fixture-source', status: 'paused', asOf: AS_OF },
      { sourceId: 'fresh-source', status: 'healthy', asOf: AS_OF }
    ]))
  })

  it('aggregates five domains, preserves domain access, and reports missing domains explicitly', async () => {
    const result = await buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF }, contextQueryService())

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    expect(result.profileId).toBe('crypto-market-analysis-v1')
    expect(result.domainAccess).toHaveLength(5)
    expect(result.domainAccess.find(domain => domain.domain === 'funding')).toMatchObject({
      queryState: 'available', freshness: 'fresh', factCount: 2, evidenceCount: 2, agentToolAvailable: false
    })
    expect(result.domainAccess.find(domain => domain.domain === 'funding')?.caveats).not.toContain('evidence-unavailable')
    expect(result.domainAccess.find(domain => domain.domain === 'macro')).toMatchObject({ queryState: 'missing' })
    expect(result.missingDomains).toEqual(expect.arrayContaining(['macro', 'cross-asset']))
    expect(result.facts.map(fact => fact.domain)).toEqual(expect.arrayContaining(['capital', 'sentiment', 'funding']))
    expect(result.facts.every(fact => fact.asOf === AS_OF)).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/https?:\/\/|\/Users\/|api[_-]?key|token|raw|provider error/i)
  })

  it('projects as-of-visible economic calendar events into macro facts and evidence', async () => {
    const result = await buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF }, contextQueryService({
      queryMacroEconomicCalendarMonth: async () => ({
        state: 'available', asOf: AS_OF, events: [
          {
            eventKey: 'US.CPI.2026-09-25', releaseGroupKey: 'US.BLS.CPI.2026-09', eventFamily: 'consumer-price-index',
            titleKey: 'cpi', countryCode: 'US', importance: 'high', periodKey: '2026-08', lifecycleState: 'released',
            coverage: 'available', scheduledDate: '2026-09-25', scheduledAt: '2026-09-25T08:30:00.000Z',
            officialReleaseDate: '2026-09-25', publishedAt: AS_OF, detectedAt: AS_OF,
            actual: { displayValue: '3.2%', numericValue: 3.2, unit: 'percent-yoy' },
            previous: { displayValue: '3.1%', numericValue: 3.1, unit: 'percent-yoy' },
            consensus: null, consensusState: 'unavailable', surprise: 'consensus-unavailable',
            providerIds: ['macro-calendar-bls'], caveats: []
          },
          {
            eventKey: 'US.FOMC.2026-09-30', releaseGroupKey: 'US.FOMC.2026-09-30', eventFamily: 'fomc',
            titleKey: 'fomc', countryCode: 'US', importance: 'high', periodKey: '2026-09-30', lifecycleState: 'scheduled',
            coverage: 'available', scheduledDate: '2026-09-30', scheduledAt: '2026-09-30T18:00:00.000Z',
            detectedAt: '2026-09-26T00:00:00.000Z', consensus: null, consensusState: 'unavailable', surprise: 'consensus-unavailable',
            providerIds: ['macro-calendar-fed'], caveats: []
          },
          {
            eventKey: 'US.NFP.2026-09-30', releaseGroupKey: 'US.BLS.NFP.2026-09', eventFamily: 'employment-situation',
            titleKey: 'nonfarm-payrolls', countryCode: 'US', importance: 'high', periodKey: '2026-09', lifecycleState: 'scheduled',
            coverage: 'available', scheduledDate: '2026-09-30', scheduledAt: '2026-09-30T12:30:00.000Z',
            detectedAt: '2026-09-26T00:00:00.001Z', consensus: null, consensusState: 'unavailable', surprise: 'consensus-unavailable',
            providerIds: ['macro-calendar-bls'], caveats: []
          }
        ]
      })
    }))

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    const macroFacts = result.facts.filter(fact => fact.domain === 'macro')
    expect(macroFacts.map(fact => fact.value)).toEqual(expect.arrayContaining(['cpi', 'released', '3.2%', '3.1%']))
    expect(macroFacts.map(fact => fact.value)).not.toContain('fomc')
    expect(macroFacts.map(fact => fact.value)).not.toContain('nonfarm-payrolls')
    expect(result.domainAccess.find(domain => domain.domain === 'macro')).toMatchObject({ queryState: 'available', factCount: macroFacts.length })
    expect(macroFacts.every(fact => fact.evidenceRefId && result.evidenceRefs.some(ref => ref.evidenceRefId === fact.evidenceRefId))).toBe(true)
    expect(result.evidenceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'macro-calendar-bls', itemId: 'US.CPI.2026-09-25', detectedAt: AS_OF, visibleAt: AS_OF })
    ]))
  })

  it('reads the dollar and gold snapshot into macro facts, and a synthetic dollar keeps its caveat', async () => {
    const result = await buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF }, contextQueryService({
      queryMacroMarketSnapshot: () => macroMarketSnapshot({ readings: [macroMarketReading(SERIES.dollarIndexReal), macroMarketReading(SERIES.gold)] })
    }))

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    const dollar = result.facts.find(fact => fact.metric === 'dollar-index-level')
    expect(dollar).toMatchObject({
      domain: 'macro', sourceId: 'twelve-data-market', value: 102.24, unit: 'index-point', observedAt: AS_OF
    })
    expect(result.facts.some(fact => fact.metric === 'dollar-index-return-24h' && fact.unit === '%')).toBe(true)
    expect(result.facts.some(fact => fact.metric === 'gold-price-usd-oz' && fact.unit === 'USD/oz')).toBe(true)
    expect(result.caveats).not.toContain('synthetic-dollar-index')

    const synthetic = await buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF }, contextQueryService({
      queryMacroMarketSnapshot: () => macroMarketSnapshot({ readings: [macroMarketReading(SERIES.dollarIndex)] })
    }))
    expect(synthetic.state).toBe('available')
    if (synthetic.state !== 'available') return
    expect(synthetic.facts.find(fact => fact.metric === 'dollar-index-level')?.value).toBe(101.42)
    // The label rides with the value: no conclusion may quote this level as the official index.
    expect(synthetic.caveats).toContain('synthetic-dollar-index')
    expect(synthetic.domainAccess.find(domain => domain.domain === 'macro')?.caveats).toContain('synthetic-dollar-index')
    expect(synthetic.caveats).toContain('provider-time-series')
  })

  it('never states an expired dollar reading as current, and names the gap instead', async () => {
    const expired = macroMarketReading(SERIES.dollarIndexReal, { atMs: Date.parse(AS_OF) - macroMarketSnapshotPublicPolicy.dollarIndexFreshnessMs - 1 })
    const result = await buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF }, contextQueryService({
      queryMacroMarketSnapshot: () => macroMarketSnapshot({ readings: [expired, macroMarketReading(SERIES.gold)] })
    }))

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    expect(result.facts.some(fact => fact.subject === 'usd-index')).toBe(false)
    expect(result.caveats).toContain('query-stale')
    // Gold arrived in the same snapshot, so the domain is available while the gap stays named.
    expect(result.facts.some(fact => fact.metric === 'gold-price-usd-oz')).toBe(true)
  })

  it('reads the FRED daily block into macro facts with the observation date and the daily-close caveat', async () => {
    const result = await buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF }, contextQueryService({
      queryMacroRatesSnapshot: () => macroRatesSnapshot()
    }))

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    const tenYear = result.facts.find(fact => fact.metric === 'us-10y-yield')
    expect(tenYear).toMatchObject({ domain: 'macro', sourceId: 'fred-rates-liquidity', value: 4.15, unit: '%' })
    // "截至 YYYY-MM-DD": the trading day is readable from the fact, not only from the snapshot.
    expect(tenYear?.observedAt).toBe('2026-09-24T00:00:00.000Z')
    expect(result.facts.find(fact => fact.metric === 'us-10y-real-yield')?.unit).toBe('%')
    // A yield difference is basis points, never a percent.
    expect(result.facts.find(fact => fact.metric === 'us-10y-2y-term-spread')).toMatchObject({ unit: 'bp' })
    expect(result.caveats).toContain('official-daily-close')
    expect(result.domainAccess.find(domain => domain.domain === 'macro')?.caveats).toContain('official-daily-close')
  })

  it('records the macro fact budget share so the macro block cannot crowd out the other domains', async () => {
    const monthly = Array.from({ length: 40 }, (_, index) =>
      marketEvent({ observationKey: `${MARKET_OBSERVATION_KEY}-${index}`, scheduledAt: `2026-09-${String((index % 28) + 1).padStart(2, '0')}T12:30:00.000Z` }))
    const result = await buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF, maxFacts: 160 }, contextQueryService({
      queryMarketCalendarMonth: () => marketPage(monthly),
      queryMacroMarketSnapshot: () => macroMarketSnapshot({ readings: [macroMarketReading(SERIES.dollarIndexReal), macroMarketReading(SERIES.gold)] }),
      queryMacroRatesSnapshot: () => macroRatesSnapshot()
    }))

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    const macroFacts = result.facts.filter(fact => fact.domain === 'macro')
    expect(macroFacts.length).toBeLessThanOrEqual(MARKET_ANALYSIS_CONTEXT_POLICY.maximumMacroFacts)
    // The macro-market and FRED facts are part of the same budget and survive beside the calendar's.
    expect(macroFacts.some(fact => fact.metric === 'dollar-index-level')).toBe(true)
    expect(macroFacts.some(fact => fact.metric === 'us-10y-yield')).toBe(true)
    expect(new Set(result.facts.map(fact => fact.domain)).size).toBeGreaterThan(1)
  })

  it('leaves the macro domain available when one of its three producers is unwired', async () => {
    const result = await buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF }, contextQueryService({
      queryMacroRatesSnapshot: () => macroRatesSnapshot()
    }))

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    // The official and 0xRouter calendars are absent in this service, but the rates landed.
    expect(result.caveats).toContain('macro-calendar-query-not-wired')
    expect(result.missingDomains).not.toContain('macro')
    expect(result.domainAccess.find(domain => domain.domain === 'macro')).toMatchObject({ queryState: 'available' })
  })

  it('reports a truthful macro gap when the economic calendar is unavailable', async () => {
    const result = await buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF }, contextQueryService({
      queryMacroEconomicCalendarMonth: async () => ({ state: 'unavailable', failureCode: 'calendar-query-unavailable' })
    }))

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    expect(result.domainAccess.find(domain => domain.domain === 'macro')).toMatchObject({ queryState: 'unavailable', freshness: 'unavailable', factCount: 0 })
    expect(result.missingDomains).toContain('macro')
    expect(result.caveats).toContain('macro-calendar-unavailable')
  })

  it('projects the 0xRouter market route as macro facts with a named unverified identity', async () => {
    const result = await buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF }, contextQueryService({
      queryMacroEconomicCalendarMonth: async () => ({ state: 'unavailable', failureCode: 'calendar-query-unavailable' }),
      queryMarketCalendarMonth: () => marketPage([marketEvent()])
    }))

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    const macroFacts = result.facts.filter(fact => fact.domain === 'macro')
    expect(macroFacts.map(fact => fact.value)).toEqual(expect.arrayContaining(['美国核心CPI年率', 'released', '3.2', '3.0']))
    expect(macroFacts.map(fact => fact.value)).not.toContain('US')
    expect(macroFacts.every(fact => fact.sourceId === 'macro-calendar-0xrouter-economic-data')).toBe(true)
    expect(result.domainAccess.find(domain => domain.domain === 'macro')).toMatchObject({ queryState: 'available', factCount: macroFacts.length })
    // The official route was down, so the gap stays named even though the month is usable.
    expect(result.caveats).toContain('macro-calendar-unavailable')
    expect(result.caveats).toContain('observed-unverified')
    expect(result.missingDomains).not.toContain('macro')
    expect(result.evidenceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'macro-calendar-0xrouter-economic-data', detectedAt: '2026-09-10T12:31:00.000Z' })
    ]))
  })

  it('attributes a macro fact to the provided consensus and expected difference, never to storage identity', async () => {
    const result = await buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF }, contextQueryService({
      queryMarketCalendarMonth: () => marketPage([marketEvent({ observationKey: JSON.stringify(['0xrouter', 'macro-calendar-0xrouter-economic-data', 'zh', JSON.stringify(['a', 1])]) })])
    }))

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    const macroFacts = result.facts.filter(fact => fact.domain === 'macro')
    expect(macroFacts.every(fact => fact.evidenceRefId && result.evidenceRefs.some(ref => ref.evidenceRefId === fact.evidenceRefId))).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/observationKey|market_fact_key|211664|sourceEventId|evidenceHash|collectionId/)
    expect(result.caveats).toContain('provider-title-is-display-name')
    expect(result.caveats).not.toContain('macro-calendar-consensus-unavailable')
  })

  it('keeps the other domains in the context when a provider month overflows the fact budget', async () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      marketEvent({ observationKey: `${MARKET_OBSERVATION_KEY}-${index}`, scheduledAt: `2026-09-${String((index % 28) + 1).padStart(2, '0')}T12:30:00.000Z` }))
    const result = await buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF }, contextQueryService({
      queryMarketCalendarMonth: () => marketPage(many)
    }))

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    // The macro share is capped so a provider cannot evict the other domains; only a slice of
    // the admitted observations' facts (7 metrics each) survives.
    const macroFacts = result.facts.filter(fact => fact.domain === 'macro').length
    expect(macroFacts).toBeLessThanOrEqual(MARKET_ANALYSIS_CONTEXT_POLICY.maximumMacroFacts)
    expect(macroFacts).toBeGreaterThan(0)
    expect(new Set(result.facts.map(fact => fact.domain))).toEqual(new Set(['macro', 'capital', 'sentiment', 'funding']))
    expect(result.caveats).toContain('provider-observations-truncated')
    // More of the provider month is admitted than before (so a day's high-importance releases fit),
    // which means the *global* fact budget now bounds this fixture too. That is the budget doing its
    // job and saying so — what must never happen is a domain disappearing, which is asserted above.
    expect(result.caveats).toContain('max-items-truncated')
  })

  it('keeps the official month available when the 0xRouter market route is unusable', async () => {
    const result = await buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF }, contextQueryService({
      queryMacroEconomicCalendarMonth: async () => ({
        state: 'available', asOf: AS_OF, events: [officialEvent()]
      }),
      queryMarketCalendarMonth: () => ({ state: 'unavailable', failureCode: 'query-unavailable' })
    }))

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    expect(result.facts.filter(fact => fact.domain === 'macro').map(fact => fact.value)).toContain('cpi')
    expect(result.caveats).toContain('provider-observation-page-unavailable')
    expect(result.domainAccess.find(domain => domain.domain === 'macro')).toMatchObject({ queryState: 'available' })
  })

  it('names the unwired macro routes instead of inventing an empty month', async () => {
    const result = await buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF }, contextQueryService())

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    expect(result.domainAccess.find(domain => domain.domain === 'macro')).toMatchObject({ queryState: 'missing', factCount: 0 })
    expect(result.caveats).toContain('macro-calendar-query-not-wired')
    expect(result.missingDomains).toContain('macro')
  })

  it('assigns safe query evidence to numeric facts so the analysis model can use them', async () => {
    const result = await buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF }, contextQueryService())

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    expect(result.facts.length).toBeGreaterThan(0)
    expect(result.facts.every((fact) => fact.evidenceRefId && result.evidenceRefs.some((ref) => ref.evidenceRefId === fact.evidenceRefId))).toBe(true)
    expect(result.domainAccess.find((domain) => domain.domain === 'funding')).toMatchObject({ evidenceCount: 2 })
    expect(result.domainAccess.find((domain) => domain.domain === 'capital')).toMatchObject({ evidenceCount: 4 })
  })

  it('counts ETF rows as capital facts and does not report a false evidence gap', async () => {
    const result = await buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF }, contextQueryService({
      queryCapitalConditionsSnapshot: async () => ({
        state: 'available', asOf: AS_OF,
        etf: {
          state: 'available', schemaVersion: 1, sourceId: '0xrouter', windowEnd: '2026-09-24', verifiedAt: AS_OF,
          btc: { asset: 'BTC', rows: [{ tradingDate: '2026-09-24', netFlowUsd: 10, observedAt: AS_OF }] },
          eth: { asset: 'ETH', rows: [{ tradingDate: '2026-09-24', netFlowUsd: -5, observedAt: AS_OF }] }
        },
        coreStablecoins: { observedAt: AS_OF, verifiedAt: AS_OF, currentUsd: 100, change1dUsd: 1, change1dPercent: 1, change7dUsd: 2, change7dPercent: 2, change30dUsd: 3, change30dPercent: 3 },
        conclusion: 'partial'
      })
    }))

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    expect(result.domainAccess.find((domain) => domain.domain === 'capital')).toMatchObject({ factCount: 6, evidenceCount: 6 })
    expect(result.domainAccess.find((domain) => domain.domain === 'capital')?.caveats).not.toContain('evidence-unavailable')
    expect(result.facts.filter((fact) => fact.metric === 'etf-net-flow-usd')).toHaveLength(2)
  })

  it('caps facts at 160 and records the truncation caveat', async () => {
    const points = Array.from({ length: 180 }, (_, index) => ({ observedAt: AS_OF, ratePercent: index / 100 }))
    const result = await buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF, maxFacts: 200 }, contextQueryService({
      queryFundingRateHistory: async () => ({ state: 'available', asOf: AS_OF, btc: points, eth: points })
    }))

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    expect(result.facts).toHaveLength(160)
    expect(new Set(result.facts.map(fact => fact.factId)).size).toBe(160)
    expect(result.caveats).toContain('max-items-truncated')
  })

  it('returns a bounded error when the safe projection exceeds 256 KiB', async () => {
    const result = await buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF }, contextQueryService({
      getSourceHealth: async () => queryEnvelope({ sources: Array.from({ length: 5000 }, (_, index) => ({
        sourceId: `safe-source-${index}-${'x'.repeat(80)}`, productionState: 'fresh', confidence: 1, caveats: []
      })) }, 'get_source_health')
    }))

    expect(result).toEqual({ state: 'unavailable', errorCode: 'analysis-context-too-large' })
  })

  it('does not leak raw provider errors into a successful or failed context result', async () => {
    const result = await buildMarketAnalysisContext({ eventGroupId: 'mi-eg-test', asOf: AS_OF }, contextQueryService({
      queryFundingRateHistory: async () => { throw new Error('https://secret.example.test/?token=raw /Users/private/provider.json') },
      getSourceHealth: async () => { throw new Error('raw provider body') }
    }))

    expect(JSON.stringify(result)).not.toMatch(/https?:\/\/|\/Users\/|token=raw|provider\.json|raw provider body/i)
    expect(result.state).toBe('available')
  })

  it('prints a safe MI-A03 context marker', () => {
    const marker = formatMarketAnalysisContextAcceptanceMarker({ domains: 5, facts: 4, missing: 2, bytes: 1234, containsSourceUrl: false })
    console.log(marker)
    expect(marker).toBe('{"marker":"MI_ANALYSIS_ACCEPTANCE","package":"MI-A03","event":"context-tool","status":"pass","details":{"domains":["macro","capital","sentiment","funding","cross-asset"],"facts":4,"missing":2,"bytes":1234,"containsSourceUrl":false}}')
    expect(marker).not.toMatch(/https?:\/\/|\/Users\/|api[_-]?key|token|prompt|raw/i)
  })
})

/**
 * The cross-asset snapshots the projection reads. Field-complete enough for the projection; the
 * strict `parseCrossAssetSnapshot` boundary is covered by `publicQueryService.test.ts`.
 */
function crossAssetSnapshotFor(range: '1h' | '24h' | '7d') {
  const lookback = range === '1h' ? 3 : range === '24h' ? 24 : 72
  const curve = (step: number) => Array.from({ length: lookback + 1 }, (_, index) => ({ at: AS_OF, returnPercent: index * step }))
  const metric = { state: 'available' as const, value: 2 }
  return {
    mode: 'historical' as const, asOf: AS_OF, analysisEnd: AS_OF, range,
    indexSource: 'real' as const,
    historyCoverage: { btc: { count: lookback, expectedCount: lookback, complete: true }, eth: { count: lookback, expectedCount: lookback, complete: true }, index: { count: lookback, expectedCount: lookback, complete: true } },
    curves: { btc: curve(0.1), eth: curve(0.05), index: curve(0.02) },
    closedReturns: { btc: { '5m': metric, '15m': metric, '1h': metric, '4h': metric, '24h': metric, '7d': metric }, eth: { '5m': metric, '15m': metric, '1h': metric, '4h': metric, '24h': metric, '7d': metric }, index: { '5m': metric, '15m': metric, '1h': metric, '4h': metric, '24h': metric, '7d': metric } }
  }
}
