import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

import { createEmptyWatchlistScope, EMPTY_EXPOSURE_SNAPSHOT, buildMonitoringScope } from './monitoringScope'
import { createIntelligencePipeline } from './intelligencePipeline'
import { createIntelligenceSourcesService } from './intelligenceSourcesService'
import { createInMemoryProfileStorage, createSourceProfileStore } from './sourceProfileStore'
import { createIntelligenceWorkspaceQueries } from './intelligenceWorkspaceQueries'
import type { WorkspaceMatchContext } from './intelligenceWorkspaceQueries'

describe('intelligenceWorkspaceQueries', () => {
  let queries: ReturnType<typeof createIntelligenceWorkspaceQueries>
  let pipeline: ReturnType<typeof createIntelligencePipeline>
  let matchContext: WorkspaceMatchContext
  let sourcesService: ReturnType<typeof createIntelligenceSourcesService>

  beforeEach(async () => {
    const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
    pipeline = createIntelligencePipeline({ profileStore })
    sourcesService = createIntelligenceSourcesService({
      profileStore,
      pipeline,
      jobRuntime: { setSchedule: () => {}, removeSchedule: () => {}, enqueueDefinition: async () => ({}) } as never
    })

    await pipeline.collectSource({
      sourceId: 'coindesk-rss',
      runId: 'run-1',
      fixtureText: loadFixture('rss-sample.xml')
    })
    await pipeline.normalizeRawRecords({ sourceId: 'coindesk-rss' })
    await pipeline.assessChangedItems({})
    await pipeline.refreshSentimentAggregates({ scopeKey: 'global', horizon: '1h' })

    queries = createIntelligenceWorkspaceQueries({ pipeline, sourcesService })
    matchContext = createMatchContext()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns clusters first in timeline rows and falls back to standalone items', async () => {
    const rows = await queries.getTimeline({ scope: 'all', timeRange: 'all', includeBackfill: true }, matchContext)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some((row) => row.identityKind === 'cluster' || row.identityKind === 'item')).toBe(true)
  })

  it('resolves latest effective assessment in detail view', async () => {
    const rows = await queries.getTimeline({ scope: 'all', timeRange: 'all', includeBackfill: true }, matchContext)
    const detail = await queries.getDetail({ itemId: rows[0]?.itemId })
    expect(detail?.latestAssessment?.assessmentId).toBeTruthy()
  })

  it('returns supporting cluster and item ids for sentiment aggregates', () => {
    pipeline.listSentimentAggregates = () => [
      {
        aggregateId: 'crypto-market:global:1h',
        scopeType: 'crypto-market',
        scopeKey: 'global',
        horizon: '1h',
        aggregateScore: -0.42,
        aggregateLabel: 'negative',
        confidence: 0.72,
        signalCount: 2,
        supportingItemIdsJson: '["item-1","item-2"]',
        supportingClusterIdsJson: '["cluster-1"]',
        sourceGroupBreakdownJson: '{"macro":-0.42}',
        layerBreakdownJson: '{"macro":-0.42}',
        directionBreakdownJson: '{"bearish":-0.42}',
        supportingImpactIdsJson: '["impact-1"]',
        updatedAt: '2026-07-06T00:00:00.000Z',
        aggregateVersion: 'macro-sector-asset-v1'
      }
    ]

    const rows = queries.getSentimentAggregates({ horizon: '1h', scopeType: 'crypto-market' })
    expect(rows[0]?.supportingItemIds).toEqual(['item-1', 'item-2'])
    expect(rows[0]?.supportingClusterIds).toEqual(['cluster-1'])
  })

  it('excludes operational events from market timeline', async () => {
    const rows = await queries.getTimeline({ scope: 'all', timeRange: 'all' }, matchContext)
    expect(rows.every((row) => !['collection-run', 'worker-heartbeat', 'archive-job', 'runtime-log'].includes(row.eventType))).toBe(true)
  })

  it('applies source group filters consistently', async () => {
    const filtered = await queries.getTimeline(
      { scope: 'all', timeRange: 'all', sourceGroup: 'mainstream-news' },
      matchContext
    )
    expect(filtered.every((row) => row.sourceGroup === 'mainstream-news')).toBe(true)
  })

  it('filters timeline rows by publishedAt and hides backfill rows by default', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-06T12:00:00.000Z'))

    const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
    const pipeline = createIntelligencePipeline({ profileStore })
    pipeline.listItems = () => [
      {
        itemId: 'item-old',
        primaryRawRecordId: 'raw-1',
        canonicalDedupeKey: 'dedupe-old',
        sourceId: 'coindesk-rss',
        eventType: 'news',
        title: '<![CDATA[Old headline]]>',
        sourceCategory: 'mainstream-news',
        sourceTrust: 'medium',
        publishedAt: '2024-01-01T00:00:00.000Z',
        detectedAt: '2026-07-06T00:00:00.000Z',
        timelineStatus: 'evaluated',
        normalizerVersion: 'rss-v1'
      },
      {
        itemId: 'item-new',
        primaryRawRecordId: 'raw-2',
        canonicalDedupeKey: 'dedupe-new',
        sourceId: 'coindesk-rss',
        eventType: 'news',
        title: 'Recent headline',
        sourceCategory: 'mainstream-news',
        sourceTrust: 'medium',
        publishedAt: '2026-07-05T10:00:00.000Z',
        detectedAt: '2026-07-06T00:00:00.000Z',
        timelineStatus: 'evaluated',
        normalizerVersion: 'rss-v1',
        processingLabelsJson: JSON.stringify({ assessmentStatus: 'evaluated' })
      }
    ]
    const sourcesService = createIntelligenceSourcesService({
      profileStore,
      pipeline,
      jobRuntime: { setSchedule: () => {}, removeSchedule: () => {}, enqueueDefinition: async () => ({}) } as never
    })
    const scopedQueries = createIntelligenceWorkspaceQueries({ pipeline, sourcesService })

    const rows = await scopedQueries.getTimeline({ scope: 'all', timeRange: '7d' }, matchContext)
    expect(rows.some((row) => row.itemId === 'item-old')).toBe(false)
    expect(rows.some((row) => row.itemId === 'item-new')).toBe(true)
    expect(rows[0]?.itemId).toBe('item-new')
  })

  it('sorts mixed legacy publishedAt formats by actual publication time', async () => {
    const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
    const pipeline = createIntelligencePipeline({ profileStore })
    pipeline.listItems = () => [
      {
        itemId: 'item-a',
        primaryRawRecordId: 'raw-a',
        canonicalDedupeKey: 'dedupe-a',
        sourceId: 'coindesk-rss',
        eventType: 'news',
        title: 'A',
        sourceCategory: 'mainstream-news',
        sourceTrust: 'medium',
        publishedAt: '<![CDATA[Mon, 06 Jul 2026 02:30:00 GMT]]>',
        detectedAt: '2026-07-06T03:00:00.000Z',
        timelineStatus: 'evaluated',
        normalizerVersion: 'rss-v1'
      },
      {
        itemId: 'item-b',
        primaryRawRecordId: 'raw-b',
        canonicalDedupeKey: 'dedupe-b',
        sourceId: 'coindesk-rss',
        eventType: 'news',
        title: 'B',
        sourceCategory: 'mainstream-news',
        sourceTrust: 'medium',
        publishedAt: '2026-07-05T11:42:00.000Z',
        detectedAt: '2026-07-06T03:00:00.000Z',
        timelineStatus: 'evaluated',
        normalizerVersion: 'rss-v1'
      }
    ]
    const sourcesService = createIntelligenceSourcesService({
      profileStore,
      pipeline,
      jobRuntime: { setSchedule: () => {}, removeSchedule: () => {}, enqueueDefinition: async () => ({}) } as never
    })
    const scopedQueries = createIntelligenceWorkspaceQueries({ pipeline, sourcesService })

    const rows = await scopedQueries.getTimeline({ scope: 'all', timeRange: 'all' }, matchContext)
    expect(rows.map((row) => row.itemId)).toEqual(['item-a', 'item-b'])
  })

  it('shows enabled sources without a successful run as pending in workspace status', async () => {
    const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
    await profileStore.saveProfile({ sourceId: 'binance-announcements', enabled: true })
    const pipeline = createIntelligencePipeline({ profileStore })
    const sourcesService = createIntelligenceSourcesService({
      profileStore,
      pipeline,
      jobRuntime: { setSchedule: () => {}, removeSchedule: () => {}, enqueueDefinition: async () => ({}) } as never
    })
    const scopedQueries = createIntelligenceWorkspaceQueries({ pipeline, sourcesService })
    const state = await scopedQueries.getWorkspaceStateAsync({
      matchContext
    })

    expect(state.overview.status.pendingSourceCount).toBeGreaterThan(0)
    expect(
      state.overview.layerDesk
        .flatMap((column) => column.sources)
        .find((source) => source.sourceId === 'binance-announcements')?.runtimeStatus
    ).toBe('pending')
  })

  it('does not expose retired DeFiLlama stablecoin health through workspace operations or layer status', async () => {
    const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
    const legacyPipeline = createIntelligencePipeline({
      profileStore,
      runtimeStateSnapshot: [
        {
          owner: 'product',
          productId: 'market-intelligence',
          resourceId: 'defillama-stablecoins',
          status: 'failed',
          consecutiveFailures: 1,
          updatedAt: '2026-08-18T09:00:00.000Z',
          lastFailureAt: '2026-08-18T09:00:00.000Z'
        }
      ]
    })
    const localSourcesService = createIntelligenceSourcesService({
      profileStore,
      pipeline: legacyPipeline,
      jobRuntime: { setSchedule: () => {}, removeSchedule: () => {}, enqueueDefinition: async () => ({}) } as never
    })
    const localQueries = createIntelligenceWorkspaceQueries({
      pipeline: legacyPipeline,
      sourcesService: localSourcesService
    })

    const operations = await localQueries.getOperationsHealth()
    const state = await localQueries.getWorkspaceStateAsync({ matchContext })

    expect(operations.sources.some((source) => source.sourceId === 'defillama-stablecoins')).toBe(false)
    expect(state.overview.layerDesk.flatMap((column) => column.sources)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceId: 'defillama-stablecoins' })])
    )
    expect(state.overview.sourceCoverage.some((source) => source.sourceId === 'defillama-stablecoins')).toBe(false)
  })

  it('uses batched translation resolution for workspace timelines', async () => {
    const translationService = {
      resolveDisplayTexts: vi.fn(async (input: { itemIds: string[] }) =>
        Object.fromEntries(
          input.itemIds.map((itemId) => [
            itemId,
            {
              title: `translated:${itemId}`,
              originalTitle: itemId,
              status: 'translated'
            }
          ])
        )
      ),
      resolveDisplayText: vi.fn(async () => undefined)
    }

    const translatedQueries = createIntelligenceWorkspaceQueries({
      pipeline,
      sourcesService,
      translationService: translationService as never
    })

    const state = await translatedQueries.getWorkspaceStateAsync({
      matchContext,
      filters: { timeRange: 'all', includeBackfill: true },
      textMode: 'translated'
    })

    expect(translationService.resolveDisplayTexts).toHaveBeenCalledOnce()
    expect(translationService.resolveDisplayText).not.toHaveBeenCalled()
    expect(state.timelineRows[0]?.displayTitle?.startsWith('translated:')).toBe(true)
  })

  it('excludes zero-signal aggregates from sentiment rows', () => {
    const pipeline = createIntelligencePipeline()
    pipeline.listSentimentAggregates = () => [
      {
        aggregateId: 'market-wide:global:1h',
        scopeType: 'market-wide',
        scopeKey: 'global',
        horizon: '1h',
        aggregateScore: 0,
        aggregateLabel: 'neutral',
        confidence: 0,
        signalCount: 0,
        supportingItemIdsJson: '[]',
        supportingClusterIdsJson: '[]',
        sourceGroupBreakdownJson: '{}',
        layerBreakdownJson: '{}',
        directionBreakdownJson: '{}',
        supportingImpactIdsJson: '[]',
        updatedAt: '2026-07-06T00:00:00.000Z',
        aggregateVersion: 'macro-sector-asset-v1'
      }
    ]
    const sourcesService = createIntelligenceSourcesService({
      profileStore: createSourceProfileStore(createInMemoryProfileStorage()),
      pipeline,
      jobRuntime: { setSchedule: () => {}, removeSchedule: () => {}, enqueueDefinition: async () => ({}) } as never
    })
    const scopedQueries = createIntelligenceWorkspaceQueries({ pipeline, sourcesService })
    const rows = scopedQueries.getSentimentAggregates({ horizon: '1h' })
    expect(rows).toHaveLength(0)
  })
  it('includes metric event and impact evidence in timeline detail for macro fixtures', async () => {
    const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
    const pipeline = createIntelligencePipeline({ profileStore })
    const sourcesService = createIntelligenceSourcesService({
      profileStore,
      pipeline,
      jobRuntime: { setSchedule: () => {}, removeSchedule: () => {}, enqueueDefinition: async () => ({}) } as never
    })
    const macroQueries = createIntelligenceWorkspaceQueries({ pipeline, sourcesService })

    await pipeline.collectSource({
      sourceId: 'bls-economic-series',
      runId: 'run-macro',
      fixtureText: loadFixture('bls-cpi-hot-sample.json')
    })
    const normalizeResult = await pipeline.normalizeRawRecords({ sourceId: 'bls-economic-series' })
    await pipeline.assessChangedItems({ itemIds: normalizeResult.newItemIds })

    const rows = await macroQueries.getTimeline({ scope: 'all', timeRange: 'all', layer: 'macro' }, matchContext)
    expect(rows.some((row) => row.direction === 'bearish')).toBe(true)

    const detail = await macroQueries.getDetail({ itemId: rows[0]?.itemId })
    expect(detail?.metricEvent?.metricName).toBeTruthy()
    expect(detail?.impacts?.length).toBeGreaterThan(0)
    expect(detail?.impacts?.[0]?.evidence.length).toBeGreaterThan(0)
  })
})

function createMatchContext(): WorkspaceMatchContext {
  const watchlistScope = createEmptyWatchlistScope()
  const portfolio = EMPTY_EXPOSURE_SNAPSHOT

  return {
    monitoringScope: buildMonitoringScope(portfolio, watchlistScope),
    matchPolicy: { positionAndWatchlistOnly: false, criticalMarketEventFallback: true },
    alerts: []
  }
}

function loadFixture(name: string): string {
  return readFileSync(
    path.join(__dirname, '../adapters/fixtures', name),
    'utf8'
  )
}
