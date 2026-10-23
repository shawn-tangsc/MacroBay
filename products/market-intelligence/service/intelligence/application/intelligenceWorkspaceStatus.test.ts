import { describe, expect, it } from 'vitest'

import { buildLayerDesk, buildWorkspaceStatus, resolveFearGreedBucket } from './intelligenceWorkspaceStatus'
import { createIntelligencePipeline } from './intelligencePipeline'
import { getIntelligenceSourceDefinition } from './sourceCatalog'
import { createDefaultSourceProfile } from './sourceRuntimeConfig'
import { createInMemoryProfileStorage, createSourceProfileStore } from './sourceProfileStore'
import type { IntelligenceSentimentAggregateRow } from './intelligenceWorkspaceQueries'

describe('intelligenceWorkspaceStatus', () => {
  it('maps fear-greed score buckets', () => {
    expect(resolveFearGreedBucket(10)).toBe('extreme-fear')
    expect(resolveFearGreedBucket(40)).toBe('fear')
    expect(resolveFearGreedBucket(50)).toBe('neutral')
    expect(resolveFearGreedBucket(60)).toBe('greed')
    expect(resolveFearGreedBucket(90)).toBe('extreme-greed')
  })

  it('reports no-sources-enabled when nothing runnable is enabled', () => {
    const pipeline = createIntelligencePipeline()
    const status = buildWorkspaceStatus({
      filters: { timeRange: '7d', horizon: '1h' },
      timelineRows: [],
      sentimentRows: [],
      profileById: new Map(),
      pipeline,
      totalTimelineCount: 0
    })

    expect(status.emptyReason).toBe('no-sources-enabled')
    expect(status.matchingEventCount).toBe(0)
    expect(status.effectiveSignalCount).toBe(0)
  })

  it('builds layer desk with planned and fixture-ready coverage', () => {
    const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
    const pipeline = createIntelligencePipeline({ profileStore })
    const desk = buildLayerDesk({
      timelineRows: [],
      profileById: new Map(),
      pipeline
    })

    const macro = desk.find((column) => column.layer === 'macro')
    expect(macro?.readinessCoverage.planned).toBeGreaterThan(0)
    expect(macro?.plannedSourceIds.length).toBeGreaterThan(0)
    expect(desk.find((column) => column.layer === 'industry')?.fixtureReadySourceIds).toBeDefined()
  })

  it('does not count disabled planned sources as urgent attention', () => {
    const pipeline = createIntelligencePipeline()
    const status = buildWorkspaceStatus({
      filters: { timeRange: '7d', horizon: '1h' },
      timelineRows: [],
      sentimentRows: [],
      profileById: new Map(),
      pipeline,
      totalTimelineCount: 0
    })

    expect(status.plannedSourceCount).toBeGreaterThan(0)
    expect(status.attentionItems.some((item) => item.kind === 'planned-source-visible')).toBe(false)
  })

  it('marks fear-greed included only when aggregate lineage contains fear-greed items', () => {
    const definition = getIntelligenceSourceDefinition('alternative-fear-greed')!
    const profile = {
      ...createDefaultSourceProfile(definition),
      enabled: true,
      includeInSentiment: true
    }
    const pipeline = createIntelligencePipeline()
    const aggregateId = 'crypto-market:global:1h'

    pipeline.listItems = () => [
      {
        itemId: 'fg-1',
        primaryRawRecordId: 'raw-fg',
        canonicalDedupeKey: 'fg-1',
        sourceId: 'alternative-fear-greed',
        eventType: 'news',
        title: 'Fear & Greed',
        sourceCategory: 'mainstream-news',
        sourceTrust: 'medium',
        detectedAt: '2026-07-06T00:00:00.000Z',
        timelineStatus: 'evaluated',
        normalizerVersion: 'v1'
      },
      {
        itemId: 'news-1',
        primaryRawRecordId: 'raw-news',
        canonicalDedupeKey: 'news-1',
        sourceId: 'coindesk-rss',
        eventType: 'news',
        title: 'Headline',
        sourceCategory: 'mainstream-news',
        sourceTrust: 'medium',
        detectedAt: '2026-07-06T00:00:00.000Z',
        timelineStatus: 'evaluated',
        normalizerVersion: 'v1'
      }
    ]

    const unrelatedRows: IntelligenceSentimentAggregateRow[] = [
      {
        aggregateId,
        scopeType: 'crypto-market',
        scopeKey: 'global',
        horizon: '1h',
        aggregateScore: -0.2,
        aggregateLabel: 'negative',
        signalCount: 1,
        supportingItemIds: ['news-1'],
        supportingClusterIds: [],
        updatedAt: '2026-07-06T00:00:00.000Z'
      }
    ]

    pipeline.listSentimentAggregates = () => [
      {
        aggregateId,
        scopeType: 'crypto-market',
        scopeKey: 'global',
        horizon: '1h',
        aggregateScore: -0.2,
        aggregateLabel: 'negative',
        confidence: 0.5,
        signalCount: 1,
        supportingItemIdsJson: '["news-1"]',
        supportingClusterIdsJson: '[]',
        sourceGroupBreakdownJson: '{}',
        layerBreakdownJson: '{}',
        directionBreakdownJson: '{}',
        supportingImpactIdsJson: '[]',
        updatedAt: '2026-07-06T00:00:00.000Z',
        aggregateVersion: 'macro-sector-asset-v1'
      }
    ]

    const unrelatedStatus = buildWorkspaceStatus({
      filters: { timeRange: '7d', horizon: '1h' },
      timelineRows: [],
      sentimentRows: unrelatedRows,
      profileById: new Map([['alternative-fear-greed', profile]]),
      pipeline,
      totalTimelineCount: 0
    })
    expect(unrelatedStatus.fearGreed?.includedInAggregate).toBe(false)

    const relatedRows: IntelligenceSentimentAggregateRow[] = [
      {
        ...unrelatedRows[0]!,
        supportingItemIds: ['fg-1']
      }
    ]
    pipeline.listSentimentAggregates = () => [
      {
        aggregateId,
        scopeType: 'crypto-market',
        scopeKey: 'global',
        horizon: '1h',
        aggregateScore: -0.2,
        aggregateLabel: 'negative',
        confidence: 0.5,
        signalCount: 1,
        supportingItemIdsJson: '["fg-1"]',
        supportingClusterIdsJson: '[]',
        sourceGroupBreakdownJson: '{}',
        layerBreakdownJson: '{}',
        directionBreakdownJson: '{}',
        supportingImpactIdsJson: '[]',
        updatedAt: '2026-07-06T00:00:00.000Z',
        aggregateVersion: 'macro-sector-asset-v1'
      }
    ]

    const relatedStatus = buildWorkspaceStatus({
      filters: { timeRange: '7d', horizon: '1h' },
      timelineRows: [],
      sentimentRows: relatedRows,
      profileById: new Map([['alternative-fear-greed', profile]]),
      pipeline,
      totalTimelineCount: 0
    })
    expect(relatedStatus.fearGreed?.includedInAggregate).toBe(true)
  })
})
