import { describe, expect, it } from 'vitest'

import type { IntelligencePipeline } from '../application/intelligencePipeline'
import type { MetricIntelligenceEvent } from '../schema/intelligenceMetricEvent'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import { readFearGreedDailyPoints } from './fearGreedDailyPoints'

const asOf = '2026-08-06T12:00:00.000Z'

describe('readFearGreedDailyPoints', () => {
  it('returns one point per source day, newest first', () => {
    const read = readFearGreedDailyPoints({
      asOf,
      pipeline: pipeline({
        metrics: [
          metric({ actual: 30, releaseTime: '2026-08-05T00:00:00.000Z', metricEventId: 'metric-2', itemId: 'item-2' }),
          metric({ actual: 22, releaseTime: '2026-08-04T00:00:00.000Z', metricEventId: 'metric-3', itemId: 'item-3' }),
          metric({ actual: 40, releaseTime: '2026-08-06T00:00:00.000Z', metricEventId: 'metric-1', itemId: 'item-1' })
        ],
        items: [item({ itemId: 'item-1' }), item({ itemId: 'item-2' }), item({ itemId: 'item-3' })]
      })
    })

    expect(read).toEqual({
      state: 'available',
      days: [
        { day: '2026-08-06', observedAt: '2026-08-06T00:00:00.000Z', score: 40, bucket: 'fear' },
        { day: '2026-08-05', observedAt: '2026-08-05T00:00:00.000Z', score: 30, bucket: 'fear' },
        { day: '2026-08-04', observedAt: '2026-08-04T00:00:00.000Z', score: 22, bucket: 'extreme-fear' }
      ]
    })
  })

  it('keeps one point for a day collected twice: the later release owns it', () => {
    const metrics = [
      metric({ actual: 22, releaseTime: '2026-08-06T09:00:00.000Z' }),
      metric({ actual: 30, releaseTime: '2026-08-06T11:00:00.000Z' })
    ]

    const read = readFearGreedDailyPoints({ asOf, pipeline: pipeline({ metrics, items: [item()] }) })

    expect(read.state).toBe('available')
    if (read.state !== 'available') return
    expect(read.days).toHaveLength(1)
    expect(read.days[0]).toMatchObject({ day: '2026-08-06', score: 30 })
  })

  it('leaves a corrupt older day out instead of breaking the whole series', () => {
    const read = readFearGreedDailyPoints({
      asOf,
      pipeline: pipeline({
        metrics: [
          metric({ actual: 101, releaseTime: '2026-08-04T00:00:00.000Z', metricEventId: 'metric-2', itemId: 'item-2' }),
          metric({ actual: 40, releaseTime: '2026-08-06T00:00:00.000Z' })
        ],
        items: [item({ itemId: 'item-1' }), item({ itemId: 'item-2' })]
      })
    })

    expect(read.state).toBe('available')
    if (read.state !== 'available') return
    expect(read.days.map((day) => day.day)).toEqual(['2026-08-06'])
  })

  it('never reads a release after as-of, and reports empty when nothing is visible', () => {
    expect(readFearGreedDailyPoints({
      asOf,
      pipeline: pipeline({
        metrics: [metric({ releaseTime: '2026-08-06T12:00:00.001Z' })],
        items: [item()]
      })
    })).toEqual({ state: 'empty' })
  })

  it('fails closed when the newest instant carries two different scores', () => {
    expect(readFearGreedDailyPoints({
      asOf,
      pipeline: pipeline({
        metrics: [metric({ actual: 22 }), metric({ metricEventId: 'metric-2', actual: 23 })],
        items: [item()]
      })
    })).toEqual({ state: 'unavailable' })
  })
})

function pipeline(input: { metrics?: MetricIntelligenceEvent[]; items?: IntelligenceItem[] }): IntelligencePipeline {
  return {
    listMetricEvents: () => input.metrics ?? [],
    listItems: () => input.items ?? []
  } as IntelligencePipeline
}

function metric(overrides: Partial<MetricIntelligenceEvent> = {}): MetricIntelligenceEvent {
  return {
    metricEventId: 'metric-1', itemId: 'item-1', sourceId: 'alternative-fear-greed', metricKey: 'FEAR_GREED_INDEX',
    metricName: 'Fear & Greed Index', metricKind: 'fear-greed', actual: 22, releaseTime: '2026-08-06T10:00:00.000Z',
    comparisonBasis: 'level', surpriseDirection: 'unknown', metricVersion: 'v1',
    ...overrides
  }
}

function item(overrides: Partial<IntelligenceItem> = {}): IntelligenceItem {
  return {
    itemId: 'item-1', primaryRawRecordId: 'raw-1', canonicalDedupeKey: 'dedupe-1', sourceId: 'alternative-fear-greed',
    eventType: 'metric', title: 'Fear & Greed', sourceCategory: 'metric', sourceTrust: 'aggregator',
    detectedAt: '2026-08-06T09:00:00.000Z', timelineStatus: 'evaluated', normalizerVersion: 'v1',
    ...overrides
  }
}