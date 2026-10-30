import { describe, expect, it, vi } from 'vitest'

import type { IntelligencePipeline } from '../application/intelligencePipeline'
import { createIntelligencePipeline } from '../application/intelligencePipeline'
import { createRawRecordStore } from '../application/rawRecordStore'
import type { IntelligenceImpact } from '../schema/intelligenceImpact'
import type { MetricIntelligenceEvent } from '../schema/intelligenceMetricEvent'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import type { IntelligenceSentimentAggregate } from '../schema/intelligenceSentiment'
import type { IntelligenceSourceDefinition } from '../schema/intelligenceSource'
import { MARKET_INTELLIGENCE_QUERY_CAVEATS } from './queryContracts'
import { createMarketIntelligencePublicQueryService } from './publicQueryService'
import { resolveRuntimeStatesAsOf } from '../store/intelligenceRuntimeStateHistory'

const AS_OF = '2026-07-08T10:30:00.000Z'

function item(overrides: Partial<IntelligenceItem> = {}): IntelligenceItem {
  return {
    itemId: 'item-1',
    primaryRawRecordId: 'raw-1',
    canonicalDedupeKey: 'dedupe-1',
    sourceId: 'binance-announcements',
    eventType: 'listing',
    title: 'BTC listing',
    summary: 'Binance lists BTC',
    sourceCategory: 'exchange-announcement',
    sourceTrust: 'high',
    publishedAt: '2026-07-08T10:00:00.000Z',
    detectedAt: '2026-07-08T11:30:00.000Z',
    symbolsJson: '["BTCUSDT"]',
    timelineStatus: 'evaluated',
    normalizerVersion: 'v1',
    ...overrides
  }
}

function impact(overrides: Partial<IntelligenceImpact> = {}): IntelligenceImpact {
  return {
    impactId: 'impact-1',
    itemId: 'item-visible',
    layer: 'asset',
    scopeType: 'symbol',
    scopeKey: 'BTCUSDT',
    direction: 'bullish',
    magnitude: 3,
    confidence: 80,
    horizon: 'intraday',
    reasoning: 'Listing impact',
    evidenceJson: '[]',
    ruleId: 'rule-1',
    ruleVersion: 'v1',
    createdAt: '2026-07-08T11:00:00.000Z',
    ...overrides
  }
}

function aggregate(overrides: Partial<IntelligenceSentimentAggregate> = {}): IntelligenceSentimentAggregate {
  return {
    aggregateId: 'agg-1',
    scopeType: 'symbol',
    scopeKey: 'BTCUSDT',
    horizon: '1h',
    aggregateScore: 0.75,
    aggregateLabel: 'positive',
    confidence: 0.8,
    signalCount: 2,
    supportingItemIdsJson: '["item-visible"]',
    supportingImpactIdsJson: '["impact-visible"]',
    updatedAt: '2026-07-08T11:00:00.000Z',
    aggregateVersion: 'v1',
    ...overrides
  }
}

function sourceDefinition(overrides: Partial<IntelligenceSourceDefinition> = {}): IntelligenceSourceDefinition {
  return {
    sourceId: 'binance-announcements',
    displayName: 'Binance Announcements',
    sourceGroup: 'exchange-announcement',
    adapterType: 'html-page-poller',
    executionMode: 'polling',
    authMode: 'none',
    category: 'exchange-announcement',
    trustLevel: 'high',
    language: 'en',
    defaultCollectionPreset: 'balanced',
    defaultRetentionMode: 'balanced',
    defaultScopePolicy: 'watchlist-priority',
    supportsSentiment: true,
    supportsCredentialTest: false,
    supportsRunNow: true,
    supportsReplay: true,
    sourceSpecificFields: [],
    visibility: 'visible',
    parserStrategy: 'binance-announcements-v1',
    adapterConfig: {},
    readiness: 'live',
    sourceKind: 'exchange-announcement',
    applicabilityMode: 'venue',
    focusMarkets: ['digital-assets'],
    intelligenceLayer: 'exchange',
    ...overrides
  } as IntelligenceSourceDefinition
}

function createMockPipeline(input: {
  items?: IntelligenceItem[]
  impacts?: IntelligenceImpact[]
  aggregates?: IntelligenceSentimentAggregate[]
  metrics?: MetricIntelligenceEvent[]
}): IntelligencePipeline {
  return {
    collectSource: async () => ({ queuedJobs: [] }),
    normalizeRawRecords: async () => ({ processedCount: 0, queuedJobs: [], newItemIds: [] }),
    assessChangedItems: async () => ({ assessmentCount: 0, failedCount: 0 }),
    retryItemAssessment: async () => ({ assessmentCount: 0, failedCount: 0 }),
    refreshSentimentAggregates: async () => ({ aggregateCount: 0 }),
    getHealth: () => undefined,
    listItems: () => input.items ?? [],
    listClusters: () => [],
    listAssessments: () => [],
    listSentimentAggregates: () => input.aggregates ?? [],
    listMetricEvents: () => input.metrics ?? [],
    listImpacts: () => input.impacts ?? [],
    listRevisions: () => [],
    listRawRecordSummaries: () => [],
    listRuntimeStates: () => [
      {
        owner: 'product',
        productId: 'market-intelligence',
        resourceId: 'binance-announcements',
        status: 'idle',
        consecutiveFailures: 0,
        updatedAt: '2026-07-08T09:00:00.000Z',
        lastSuccessAt: '2026-07-08T09:00:00.000Z'
      }
    ],
    listRuntimeStatesAsOf: (asOf) =>
      resolveRuntimeStatesAsOf(
        [
          {
            owner: 'product',
            productId: 'market-intelligence',
            resourceId: 'binance-announcements',
            status: 'idle',
            consecutiveFailures: 0,
            updatedAt: '2026-07-08T09:00:00.000Z',
            lastSuccessAt: '2026-07-08T09:00:00.000Z'
          }
        ],
        asOf
      ),
    reportConnectivityProbe: () => undefined
  }
}

describe('publicQueryService hindsight regressions', () => {
  it('returns the compact Fear & Greed snapshot without a generic query envelope', async () => {
    const result = await createMarketIntelligencePublicQueryService({
      pipeline: createMockPipeline({
        metrics: [{
          metricEventId: 'metric-1', itemId: 'fear-greed-item', sourceId: 'alternative-fear-greed', metricKey: 'FEAR_GREED_INDEX',
          metricName: 'Fear & Greed', metricKind: 'fear-greed', actual: 22, releaseTime: AS_OF,
          comparisonBasis: 'level', surpriseDirection: 'unknown', metricVersion: 'v1'
        }],
        items: [item({ itemId: 'fear-greed-item', sourceId: 'alternative-fear-greed', detectedAt: AS_OF })]
      })
    }).queryFearGreedSnapshot({ asOf: AS_OF })

    expect(result).toEqual({ state: 'available', asOf: AS_OF, score: 22, bucket: 'extreme-fear', observedAt: AS_OF })
  })

  it('does not resolve macro-calendar raw evidence through the generic public query path', async () => {
    const rawRecordStore = createRawRecordStore()
    const macro = rawRecordStore.appendRawRecord({
      sourceId: 'macro-calendar-bls', runId: 'macro-run', sourceDedupeKey: 'macro-evidence-1', payloadFormat: 'json',
      payloadRefType: 'file', payloadFileRef: '/private/macro.json', payloadHash: 'macro-hash', parserVersion: 'fixture-v1', processingOwner: 'macro-calendar'
    })!
    const service = createMarketIntelligencePublicQueryService({ pipeline: createIntelligencePipeline({ rawRecordStore }), listSourceDefinitions: () => [] })

    const result = await service.getEvidenceExcerpt({ asOf: '2026-08-03T00:00:00.000Z', evidenceRefId: macro.rawRecordId })
    expect(result.caveats).toContain(MARKET_INTELLIGENCE_QUERY_CAVEATS.evidenceNotVisibleAsOf)
    expect(JSON.stringify(result)).not.toContain('/private/macro.json')
  })

  it('reads the cross-asset snapshot the analysis needs, and only in the shape the panel accepts', async () => {
    const snapshot = crossAssetSnapshot()
    const query = vi.fn(() => snapshot)
    const service = createMarketIntelligencePublicQueryService({ pipeline: createIntelligencePipeline({ rawRecordStore: createRawRecordStore() }), listSourceDefinitions: () => [] })

    // Nothing wired yet: the analysis must read "no cross-asset evidence", not crash.
    expect(await service.queryCrossAssetSnapshot({ range: '24h', asOf: AS_OF })).toBeUndefined()

    service.setCrossAssetQuery({ query })
    expect(await service.queryCrossAssetSnapshot({ range: '1h', asOf: AS_OF })).toMatchObject({ mode: 'historical', range: '1h' })
    expect(query).toHaveBeenCalledWith({ range: '1h', asOf: AS_OF })
  })

  it('fails closed on a throwing or malformed cross-asset query instead of leaking an unvalidated shape', async () => {
    const service = createMarketIntelligencePublicQueryService({ pipeline: createIntelligencePipeline({ rawRecordStore: createRawRecordStore() }), listSourceDefinitions: () => [] })

    service.setCrossAssetQuery({ query: () => { throw new Error('store-unavailable') } })
    expect(await service.queryCrossAssetSnapshot({ range: '1h', asOf: AS_OF })).toBeUndefined()

    // A snapshot the renderer would reject is not evidence the analysis may cite.
    service.setCrossAssetQuery({ query: () => ({ schemaVersion: 1, mode: 'historical' }) })
    expect(await service.queryCrossAssetSnapshot({ range: '1h', asOf: AS_OF })).toBeUndefined()

    service.setCrossAssetQuery(undefined)
    expect(await service.queryCrossAssetSnapshot({ range: '1h', asOf: AS_OF })).toBeUndefined()
  })

  it('reads the macro history through one late-bound reader, and fails closed when it is unwired', () => {
    const service = createMarketIntelligencePublicQueryService({
      pipeline: createIntelligencePipeline({ rawRecordStore: createRawRecordStore() }), listSourceDefinitions: () => []
    })

    // Unwired is "no historical answer exists in this build", not an empty store.
    expect(service.queryMacroHistoryAsOf({ series: 'dxy', asOf: AS_OF })).toBeUndefined()

    const read = vi.fn(() => ({
      state: 'unavailable' as const, series: 'dxy', asOf: AS_OF,
      gapCode: 'historical-as-of-unavailable' as const, detail: 'the store holds no point at or before this instant.'
    }))
    service.setMacroHistoryAsOfQuery({ read })
    expect(service.queryMacroHistoryAsOf({ series: 'dxy', asOf: AS_OF }))
      .toMatchObject({ state: 'unavailable', gapCode: 'historical-as-of-unavailable' })
    expect(read).toHaveBeenCalledWith({ series: 'dxy', asOf: AS_OF })

    service.setMacroHistoryAsOfQuery({ read: () => { throw new Error('store down') } })
    expect(service.queryMacroHistoryAsOf({ series: 'gold', asOf: AS_OF })).toBeUndefined()
  })

  it('does not return events whose detectedAt is after asOf even when publishedAt is earlier', async () => {
    const service = createMarketIntelligencePublicQueryService({
      pipeline: createMockPipeline({
        items: [item()],
        impacts: [],
        aggregates: []
      }),
      listSourceDefinitions: () => [sourceDefinition()]
    })

    const result = await service.queryRelatedEvents({
      asOf: AS_OF,
      scope: { symbol: 'BTCUSDT' }
    })

    expect(result.data.events).toHaveLength(0)
    expect(result.caveats).not.toContain(MARKET_INTELLIGENCE_QUERY_CAVEATS.eventDetectedAfterActionTime)
  })

  it('returns visible events without impacts when impact is computed after asOf', async () => {
    const visibleItem = item({
      itemId: 'item-visible',
      detectedAt: '2026-07-08T10:00:00.000Z',
      publishedAt: '2026-07-08T09:30:00.000Z'
    })
    const service = createMarketIntelligencePublicQueryService({
      pipeline: createMockPipeline({
        items: [visibleItem],
        impacts: [impact({ itemId: 'item-visible', createdAt: '2026-07-08T11:00:00.000Z' })],
        aggregates: []
      }),
      listSourceDefinitions: () => [sourceDefinition()]
    })

    const result = await service.queryRelatedEvents({
      asOf: AS_OF,
      scope: { symbol: 'BTCUSDT' }
    })

    expect(result.data.events).toHaveLength(1)
    expect(result.data.events[0]?.impacts).toHaveLength(0)
    expect(result.data.events[0]?.caveats).toContain(MARKET_INTELLIGENCE_QUERY_CAVEATS.impactNotComputedAsOf)
  })

  it('returns unknown sentiment instead of neutral zero when no aggregate is visible asOf', async () => {
    const service = createMarketIntelligencePublicQueryService({
      pipeline: createMockPipeline({
        aggregates: [aggregate({ updatedAt: '2026-07-08T11:00:00.000Z' })]
      }),
      listSourceDefinitions: () => [sourceDefinition()]
    })

    const result = await service.querySentimentSnapshot({
      asOf: AS_OF,
      scope: { symbol: 'BTCUSDT' }
    })

    expect(result.data.status).toBe('unknown')
    expect(result.data.score).toBeUndefined()
    expect(result.caveats).toContain(MARKET_INTELLIGENCE_QUERY_CAVEATS.sentimentNotComputedAsOf)
  })

  it('uses only aggregates visible at each series point', async () => {
    const service = createMarketIntelligencePublicQueryService({
      pipeline: createMockPipeline({
        aggregates: [
          aggregate({ aggregateId: 'agg-old', updatedAt: '2026-07-08T09:00:00.000Z', aggregateScore: 0.2 }),
          aggregate({ aggregateId: 'agg-new', updatedAt: '2026-07-08T11:00:00.000Z', aggregateScore: 0.9 })
        ]
      }),
      listSourceDefinitions: () => [sourceDefinition()]
    })

    const result = await service.querySentimentSeries({
      asOf: AS_OF,
      scope: { symbol: 'BTCUSDT' },
      from: '2026-07-08T08:00:00.000Z'
    })

    expect(result.data.points).toHaveLength(1)
    expect(result.data.points[0]?.score).toBe(0.2)
  })

  it('rejects evidence excerpt when detectedAt is after asOf', async () => {
    const service = createMarketIntelligencePublicQueryService({
      pipeline: createMockPipeline({
        items: [item({ itemId: 'item-late', detectedAt: '2026-07-08T11:00:00.000Z' })]
      }),
      listSourceDefinitions: () => [sourceDefinition()]
    })

    const result = await service.getEvidenceExcerpt({
      asOf: AS_OF,
      itemId: 'item-late'
    })

    expect(result.caveats).toContain(MARKET_INTELLIGENCE_QUERY_CAVEATS.evidenceNotVisibleAsOf)
  })

  it('returns the same resultHash for repeated identical queries but different queryIds', async () => {
    const service = createMarketIntelligencePublicQueryService({
      pipeline: createMockPipeline({
        aggregates: [aggregate({ updatedAt: '2026-07-08T10:00:00.000Z' })]
      }),
      listSourceDefinitions: () => [sourceDefinition()]
    })

    const first = await service.querySentimentSnapshot({
      asOf: AS_OF,
      scope: { symbol: 'BTCUSDT' }
    })
    const second = await service.querySentimentSnapshot({
      asOf: AS_OF,
      scope: { symbol: 'BTCUSDT' }
    })

    expect(first.resultHash).toBe(second.resultHash)
    expect(first.queryId).not.toBe(second.queryId)
  })

  it('returns stable query envelopes with resultHash', async () => {
    const service = createMarketIntelligencePublicQueryService({
      pipeline: createMockPipeline({
        aggregates: [aggregate({ updatedAt: '2026-07-08T10:00:00.000Z' })]
      }),
      listSourceDefinitions: () => [sourceDefinition()]
    })

    const result = await service.querySentimentSnapshot({
      asOf: AS_OF,
      scope: { symbol: 'BTCUSDT' }
    })

    expect(result.schemaVersion).toBe(1)
    expect(result.queryType).toBe('query_sentiment_snapshot')
    expect(result.resultHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.data.status).toBe('available')
  })

  it('evaluates source health from revision history instead of latest overwritten state', async () => {
    const revisions = [
      {
        owner: 'product' as const,
        productId: 'market-intelligence',
        resourceId: 'binance-announcements',
        status: 'idle' as const,
        consecutiveFailures: 0,
        updatedAt: '2026-07-08T09:00:00.000Z',
        lastSuccessAt: '2026-07-08T09:00:00.000Z'
      },
      {
        owner: 'product' as const,
        productId: 'market-intelligence',
        resourceId: 'binance-announcements',
        status: 'failed' as const,
        consecutiveFailures: 1,
        updatedAt: '2026-07-08T09:30:00.000Z',
        lastSuccessAt: '2026-07-08T09:00:00.000Z',
        lastFailureAt: '2026-07-08T09:30:00.000Z'
      },
      {
        owner: 'product' as const,
        productId: 'market-intelligence',
        resourceId: 'binance-announcements',
        status: 'failed' as const,
        consecutiveFailures: 2,
        updatedAt: '2026-07-08T10:30:00.000Z',
        lastSuccessAt: '2026-07-08T09:00:00.000Z',
        lastFailureAt: '2026-07-08T10:30:00.000Z'
      }
    ]

    const pipeline = createMockPipeline({ items: [] })
    pipeline.listRuntimeStates = () => [revisions[revisions.length - 1]!]
    pipeline.listRuntimeStatesAsOf = (asOf) => resolveRuntimeStatesAsOf(revisions, asOf)

    const historicalService = createMarketIntelligencePublicQueryService({
      pipeline,
      listSourceDefinitions: () => [sourceDefinition()]
    })

    const result = await historicalService.getSourceHealth({ asOf: '2026-07-08T10:00:00.000Z' })
    const source = result.data.sources.find((entry) => entry.sourceId === 'binance-announcements')

    expect(source?.productionState).toBe('failed')
    expect(source?.latestFailureAt).toBe('2026-07-08T09:30:00.000Z')
  })

  it('does not expose retired DeFiLlama stablecoin runtime health through public source coverage', async () => {
    const pipeline = createIntelligencePipeline({
      runtimeStateSnapshot: [
        {
          owner: 'product',
          productId: 'market-intelligence',
          resourceId: 'defillama-stablecoins',
          status: 'failed',
          consecutiveFailures: 1,
          updatedAt: '2026-07-08T09:00:00.000Z',
          lastFailureAt: '2026-07-08T09:00:00.000Z'
        },
        {
          owner: 'product',
          productId: 'market-intelligence',
          resourceId: 'binance-announcements',
          status: 'idle',
          consecutiveFailures: 0,
          updatedAt: '2026-07-08T09:00:00.000Z',
          lastSuccessAt: '2026-07-08T09:00:00.000Z'
        }
      ]
    })
    const service = createMarketIntelligencePublicQueryService({
      pipeline,
      listSourceDefinitions: () => [
        sourceDefinition({ sourceId: 'defillama-stablecoins', displayName: 'DeFiLlama Stablecoins' }),
        sourceDefinition()
      ]
    })

    const result = await service.getSourceHealth({ asOf: AS_OF })

    expect(result.data.sources.map((source) => source.sourceId)).toEqual(['binance-announcements'])
  })

  it('resolves evidence excerpt by impactId and clusterId', async () => {
    const visibleItem = item({
      itemId: 'item-visible',
      clusterId: 'cluster-1',
      detectedAt: '2026-07-08T10:00:00.000Z'
    })
    const pipeline = createMockPipeline({
      items: [visibleItem],
      impacts: [impact({ impactId: 'impact-1', itemId: 'item-visible', createdAt: '2026-07-08T10:05:00.000Z' })]
    })
    pipeline.listClusters = () => [
      {
        clusterId: 'cluster-1',
        clusterKey: 'cluster-key',
        clusterType: 'announcement',
        title: 'Cluster',
        primaryItemId: 'item-visible',
        primarySourceId: 'binance-announcements',
        status: 'open',
        lastDetectedAt: '2026-07-08T10:00:00.000Z',
        clusterVersion: 'v1'
      }
    ]

    const service = createMarketIntelligencePublicQueryService({
      pipeline,
      listSourceDefinitions: () => [sourceDefinition()]
    })

    const byImpact = await service.getEvidenceExcerpt({ asOf: AS_OF, impactId: 'impact-1' })
    const byCluster = await service.getEvidenceExcerpt({ asOf: AS_OF, clusterId: 'cluster-1' })

    expect(byImpact.data.title).toBe('BTC listing')
    expect(byCluster.data.title).toBe('BTC listing')
  })

  it('rejects evidence excerpt when impact or cluster is not visible asOf', async () => {
    const visibleItem = item({
      itemId: 'item-visible',
      clusterId: 'cluster-1',
      detectedAt: '2026-07-08T10:00:00.000Z'
    })
    const pipeline = createMockPipeline({
      items: [visibleItem],
      impacts: [impact({ impactId: 'impact-late', itemId: 'item-visible', createdAt: '2026-07-08T11:00:00.000Z' })]
    })
    pipeline.listClusters = () => [
      {
        clusterId: 'cluster-late',
        clusterKey: 'cluster-key',
        clusterType: 'announcement',
        title: 'Cluster',
        primaryItemId: 'item-visible',
        primarySourceId: 'binance-announcements',
        status: 'open',
        lastDetectedAt: '2026-07-08T11:00:00.000Z',
        clusterVersion: 'v1'
      }
    ]

    const service = createMarketIntelligencePublicQueryService({
      pipeline,
      listSourceDefinitions: () => [sourceDefinition()]
    })

    const byImpact = await service.getEvidenceExcerpt({ asOf: AS_OF, impactId: 'impact-late' })
    const byCluster = await service.getEvidenceExcerpt({ asOf: AS_OF, clusterId: 'cluster-late' })

    expect(byImpact.caveats).toContain(MARKET_INTELLIGENCE_QUERY_CAVEATS.evidenceNotVisibleAsOf)
    expect(byCluster.caveats).toContain(MARKET_INTELLIGENCE_QUERY_CAVEATS.evidenceNotVisibleAsOf)
  })

  it('filters impact timeline by sourceIds', async () => {
    const binanceItem = item({
      itemId: 'item-binance',
      sourceId: 'binance-announcements',
      detectedAt: '2026-07-08T10:00:00.000Z',
      symbolsJson: '["BTCUSDT"]'
    })
    const coindeskItem = item({
      itemId: 'item-coindesk',
      sourceId: 'coindesk-rss',
      detectedAt: '2026-07-08T10:00:00.000Z',
      symbolsJson: '["BTCUSDT"]'
    })
    const pipeline = createMockPipeline({
      items: [binanceItem, coindeskItem],
      impacts: [
        impact({ impactId: 'impact-binance', itemId: 'item-binance', createdAt: '2026-07-08T10:05:00.000Z' }),
        impact({ impactId: 'impact-coindesk', itemId: 'item-coindesk', createdAt: '2026-07-08T10:05:00.000Z' })
      ]
    })

    const service = createMarketIntelligencePublicQueryService({
      pipeline,
      listSourceDefinitions: () => [sourceDefinition()]
    })

    const result = await service.queryImpactTimeline({
      asOf: AS_OF,
      scope: { symbol: 'BTCUSDT' },
      filters: { sourceIds: ['binance-announcements'] }
    })

    expect(result.data.impacts).toHaveLength(1)
    expect(result.data.impacts[0]?.impactId).toBe('impact-binance')
    expect(result.data.impacts[0]?.sourceId).toBe('binance-announcements')
  })

  it('evaluates source health as-of and ignores health updates after asOf', async () => {
    const revisions = [
      {
        owner: 'product' as const,
        productId: 'market-intelligence',
        resourceId: 'binance-announcements',
        status: 'failed' as const,
        consecutiveFailures: 2,
        updatedAt: '2026-07-08T09:30:00.000Z',
        lastSuccessAt: '2026-07-08T09:00:00.000Z',
        lastFailureAt: '2026-07-08T09:30:00.000Z'
      },
      {
        owner: 'product' as const,
        productId: 'market-intelligence',
        resourceId: 'binance-announcements',
        status: 'idle' as const,
        consecutiveFailures: 0,
        updatedAt: '2026-07-08T12:00:00.000Z',
        lastSuccessAt: '2026-07-08T12:00:00.000Z',
        lastFailureAt: '2026-07-08T09:30:00.000Z'
      }
    ]

    const pipeline = createMockPipeline({ items: [] })
    pipeline.listRuntimeStates = () => [revisions[revisions.length - 1]!]
    pipeline.listRuntimeStatesAsOf = (asOf) => resolveRuntimeStatesAsOf(revisions, asOf)

    const historicalService = createMarketIntelligencePublicQueryService({
      pipeline,
      listSourceDefinitions: () => [sourceDefinition()]
    })

    const result = await historicalService.getSourceHealth({ asOf: AS_OF })
    const source = result.data.sources.find((entry) => entry.sourceId === 'binance-announcements')

    expect(source?.productionState).toBe('failed')
    expect(source?.caveats).toContain(MARKET_INTELLIGENCE_QUERY_CAVEATS.sourceFailedBeforeAsOf)
  })

  it('fails closed on the 0xRouter market calendar route until a query is wired', () => {
    const service = createMarketIntelligencePublicQueryService({ pipeline: createMockPipeline({ items: [] }), listSourceDefinitions: () => [] })

    expect(service.queryMarketCalendarMonth({ month: '2026-09', locale: 'zh', asOf: AS_OF }))
      .toEqual({ state: 'unavailable', failureCode: 'query-unavailable' })
  })

  it('serves the wired 0xRouter market calendar page and stops serving it after it is unset', () => {
    const page = { state: 'available' as const, month: '2026-09', locale: 'zh' as const, asOf: AS_OF, events: [],
      sources: ['economic-indicator', 'financial-event', 'central-bank-activity'].map(eventType => ({ eventType,
        status: 'success' as const, sourceObservedAt: AS_OF })) }
    const service = createMarketIntelligencePublicQueryService({ pipeline: createMockPipeline({ items: [] }), listSourceDefinitions: () => [] })
    service.setMarketCalendarQuery({ queryMonth: () => page })

    expect(service.queryMarketCalendarMonth({ month: '2026-09', locale: 'zh', asOf: AS_OF })).toBe(page)

    service.setMarketCalendarQuery(undefined)
    expect(service.queryMarketCalendarMonth({ month: '2026-09', locale: 'zh', asOf: AS_OF }))
      .toEqual({ state: 'unavailable', failureCode: 'query-unavailable' })
  })
})

/** The canonical historical cross-asset snapshot, in the shape `parseCrossAssetSnapshot` accepts. */
function crossAssetSnapshot() {
  const now = Date.parse(AS_OF)
  const metric = { state: 'unavailable' as const, reason: 'missing' as const }
  const perAsset = <T,>(build: () => T): Record<'index' | 'btc' | 'eth', T> => ({ index: build(), btc: build(), eth: build() })
  return { schemaVersion: 1 as const, mode: 'historical' as const, servedAt: new Date(now).toISOString(), asOf: new Date(now).toISOString(), range: '1h' as const,
    analysisEnd: new Date(now).toISOString(), windowStart: new Date(now - 3_600_000).toISOString(),
    historyCoverage: perAsset(() => ({ count: 0, expectedCount: 13, complete: false })),
    curves: perAsset(() => Array.from({ length: 13 }, (_, index) => ({ at: new Date(now - (12 - index) * 300_000).toISOString(), returnPercent: null }))),
    closedReturns: perAsset(() => ({ '5m': metric, '15m': metric, '1h': metric, '4h': metric, '24h': metric, '7d': metric })),
    correlations: { indexBtc: { ...metric, sampleCount: 0, expectedCount: 288 }, indexEth: { ...metric, sampleCount: 0, expectedCount: 288 } },
    relativeReturns: { btcMinusIndex: metric, ethMinusBtc: metric },
    observationKey: { indexBtc: 'unavailable' as const, ethBtc: 'unavailable' as const },
    indexSource: 'unavailable' as const }
}
