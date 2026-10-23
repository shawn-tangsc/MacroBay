import { describe, expect, it, vi } from 'vitest'

import { createEventBusRuntime } from '@platform/message-bus'
import { createEventBusStore } from '@platform/message-bus/store/eventBusStore'

import { INTELLIGENCE_EVENT_TOPICS } from '../schema/intelligenceEvents'
import { createIntelligenceEventPublisher } from './intelligenceEventPublisher'

describe('intelligenceEventPublisher', () => {
  it('publishes impact events with stable idempotency keys', async () => {
    const store = createEventBusStore()
    const eventBus = createEventBusRuntime({ store })
    const publishDurably = vi.fn(eventBus.publishDurably.bind(eventBus))
    const publisher = createIntelligenceEventPublisher({ publishDurably } as never)

    await publisher.publishImpactCreated({
      impact: {
        impactId: 'impact-item-1-1',
        itemId: 'item-1',
        clusterId: 'cluster-1',
        layer: 'macro',
        scopeType: 'symbol',
        scopeKey: 'BTC',
        direction: 'bearish',
        magnitude: 4,
        confidence: 82,
        horizon: 'intraday',
        reasoning: 'CPI hotter than expected',
        evidenceJson: '[]',
        ruleId: 'macro-cpi-hot',
        ruleVersion: 'v1',
        createdAt: '2026-07-08T09:00:00.000Z'
      },
      item: {
        itemId: 'item-1',
        clusterId: 'cluster-1',
        primaryRawRecordId: 'raw-1',
        canonicalDedupeKey: 'dedupe-1',
        sourceId: 'bls-cpi',
        eventType: 'macro-release',
        title: 'US CPI accelerates',
        sourceCategory: 'macro',
        sourceTrust: 'high',
        detectedAt: '2026-07-08T09:00:00.000Z',
        timelineStatus: 'evaluated',
        normalizerVersion: 'v1'
      },
      title: 'US CPI accelerates',
      summary: 'Headline CPI came in above expectations.'
    })

    expect(publishDurably).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: INTELLIGENCE_EVENT_TOPICS.impactCreated,
        idempotencyKey: 'market-intelligence:impact:impact-item-1-1:v1',
        payload: expect.objectContaining({
          impactId: 'impact-item-1-1',
          affectedScopes: [{ type: 'symbol', id: 'BTC' }]
        })
      })
    )
  })
})
