import { describe, expect, it } from 'vitest'

import {
  buildExchangeAnnouncementClusterKey,
  buildStatuspageClusterKey,
  resolveCluster,
  titleSimilarity
} from './clusterResolver'
import type { IntelligenceEventCluster, IntelligenceItem } from '../schema/intelligenceRecord'

describe('clusterResolver', () => {
  it('maps statuspage vendor incident id to one cluster', () => {
    const clusterKey = buildStatuspageClusterKey('inc-123')
    const first = resolveCluster({
      candidate: candidate({
        clusterKey,
        clusterType: 'incident',
        sourceGroup: 'exchange-status',
        sourceId: 'coinbase-status'
      }),
      existingClusters: [],
      existingItems: []
    })

    const second = resolveCluster({
      candidate: candidate({
        clusterKey,
        clusterType: 'incident',
        sourceGroup: 'exchange-status',
        sourceId: 'coinbase-status',
        itemId: 'item-2',
        title: 'Incident updated'
      }),
      existingClusters: [first.cluster],
      existingItems: []
    })

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.cluster.clusterId).toBe(first.cluster.clusterId)
  })

  it('does not cross-source merge exchange announcements in v1', () => {
    const first = resolveCluster({
      candidate: candidate({
        clusterKey: buildExchangeAnnouncementClusterKey('binance-announcements', 'article-1'),
        clusterType: 'announcement',
        sourceGroup: 'exchange-announcement',
        sourceId: 'binance-announcements',
        title: 'BTC maintenance'
      }),
      existingClusters: [],
      existingItems: []
    })

    const second = resolveCluster({
      candidate: candidate({
        clusterKey: buildExchangeAnnouncementClusterKey('okx-latest-announcements', 'article-1'),
        clusterType: 'announcement',
        sourceGroup: 'exchange-announcement',
        sourceId: 'okx-latest-announcements',
        title: 'BTC maintenance',
        itemId: 'item-2'
      }),
      existingClusters: [first.cluster],
      existingItems: []
    })

    expect(second.created).toBe(true)
    expect(second.cluster.clusterId).not.toBe(first.cluster.clusterId)
  })

  it('clusters macro news within 60 minutes when entities and title similarity pass', () => {
    const existingCluster: IntelligenceEventCluster = {
      clusterId: 'cluster-macro-1',
      clusterKey: 'macro:fed-rate',
      clusterType: 'macro-event',
      title: 'Federal Reserve keeps rates unchanged',
      primaryItemId: 'item-1',
      primarySourceId: 'federal-reserve-rss',
      status: 'open',
      firstPublishedAt: '2026-07-05T10:00:00.000Z',
      lastPublishedAt: '2026-07-05T10:00:00.000Z',
      lastDetectedAt: '2026-07-05T10:01:00.000Z',
      clusterVersion: 'v1'
    }

    const existingItem: IntelligenceItem = {
      itemId: 'item-1',
      clusterId: existingCluster.clusterId,
      primaryRawRecordId: 'raw-1',
      canonicalDedupeKey: 'rss:guid:1',
      sourceId: 'federal-reserve-rss',
      eventType: 'macro',
      title: existingCluster.title,
      sourceCategory: 'macro',
      sourceTrust: 'high',
      publishedAt: '2026-07-05T10:00:00.000Z',
      detectedAt: '2026-07-05T10:01:00.000Z',
      entitiesJson: JSON.stringify(['FED', 'RATES']),
      timelineStatus: 'new',
      normalizerVersion: 'v1'
    }

    const result = resolveCluster({
      candidate: candidate({
        clusterKey: 'macro:coindesk-fed-rate',
        clusterType: 'macro-event',
        sourceGroup: 'mainstream-news',
        sourceId: 'coindesk-rss',
        title: 'Federal Reserve keeps rates unchanged today',
        publishedAt: '2026-07-05T10:20:00.000Z',
        detectedAt: '2026-07-05T10:21:00.000Z',
        entities: ['FED', 'RATES'],
        itemId: 'item-2'
      }),
      existingClusters: [existingCluster],
      existingItems: [existingItem]
    })

    expect(result.created).toBe(false)
    expect(result.cluster.clusterId).toBe(existingCluster.clusterId)
    expect(titleSimilarity(existingCluster.title, 'Federal Reserve keeps rates unchanged today')).toBeGreaterThan(0.5)
  })
})

function candidate(
  overrides: Partial<Parameters<typeof resolveCluster>[0]['candidate']> &
    Pick<Parameters<typeof resolveCluster>[0]['candidate'], 'clusterKey'>
) {
  return {
    sourceId: 'source-1',
    sourceGroup: 'mainstream-news',
    clusterType: 'news-event' as const,
    title: 'Sample headline',
    detectedAt: '2026-07-05T10:00:00.000Z',
    entities: [],
    itemId: 'item-1',
    trustLevel: 'medium' as const,
    ...overrides
  }
}
