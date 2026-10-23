import { describe, expect, it } from 'vitest'

import type { IntelligencePipeline } from '../application/intelligencePipeline'
import type { MetricIntelligenceEvent } from '../schema/intelligenceMetricEvent'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import { queryFearGreedSnapshot } from './fearGreedSnapshotQuery'

const asOf = '2026-08-06T12:00:00.000Z'

describe('queryFearGreedSnapshot', () => {
  it('returns only the latest visible fixed-source observation', () => {
    const result = queryFearGreedSnapshot({
      asOf,
      pipeline: pipeline({
        metrics: [metric({ actual: 22, releaseTime: '2026-08-06T10:00:00.000Z' })],
        items: [item()]
      })
    })

    expect(result).toEqual({
      state: 'available',
      asOf,
      score: 22,
      bucket: 'extreme-fear',
      observedAt: '2026-08-06T10:00:00.000Z'
    })
    expect(JSON.stringify(result)).not.toMatch(/itemId|metricEventId|rawValue|classification|https?:|evidence|profile|health|credential/i)
  })

  it.each([
    ['no matching metric', [], []],
    ['another source', [metric({ sourceId: 'other-source' })], [item({ sourceId: 'other-source' })]],
    ['another metric key', [metric({ metricKey: 'OTHER' })], [item()]],
    ['a future observed metric', [metric({ releaseTime: '2026-08-06T12:00:00.001Z' })], [item()]],
    ['a metric detected after as-of', [metric()], [item({ detectedAt: '2026-08-06T12:00:00.001Z' })]]
  ])('returns empty for %s', (_name, metrics, items) => {
    expect(queryFearGreedSnapshot({ asOf, pipeline: pipeline({ metrics, items }) })).toEqual({ state: 'empty', asOf })
  })

  it.each([
    ['bad as-of', { asOf: '2026-08-06T12:00:00Z', metrics: [metric()], items: [item()] }],
    ['missing linked item', { asOf, metrics: [metric()], items: [] }],
    ['missing matching metric item ID', { asOf, metrics: [metric({ itemId: undefined })], items: [item({ itemId: undefined })] }],
    ['missing matching linked item ID', { asOf, metrics: [metric()], items: [item({ itemId: undefined })] }],
    ['duplicate matching linked item IDs', { asOf, metrics: [metric()], items: [item(), item({ primaryRawRecordId: 'raw-2' })] }],
    ['wrong linked source', { asOf, metrics: [metric()], items: [item({ sourceId: 'other-source' })] }],
    ['malformed release time', { asOf, metrics: [metric({ releaseTime: 'invalid' })], items: [item()] }],
    ['malformed detected time', { asOf, metrics: [metric()], items: [item({ detectedAt: 'invalid' })] }],
    ['noninteger score', { asOf, metrics: [metric({ actual: 22.5 })], items: [item()] }],
    ['out of range score', { asOf, metrics: [metric({ actual: 101 })], items: [item()] }],
    ['conflicting newest observations', { asOf, metrics: [metric({ actual: 22 }), metric({ metricEventId: 'metric-2', actual: 23 })], items: [item()] }]
  ])('fails closed for %s', (_name, input) => {
    expect(queryFearGreedSnapshot({ ...input, pipeline: pipeline(input) })).toEqual({
      state: 'unavailable',
      failureCode: 'fear-greed-query-unavailable'
    })
  })

  it('does not let an older malformed matching value hide a later valid observation', () => {
    expect(queryFearGreedSnapshot({
      asOf,
      pipeline: pipeline({
        metrics: [metric({ actual: 101, releaseTime: '2026-08-06T09:00:00.000Z' }), metric({ actual: 66, releaseTime: '2026-08-06T10:00:00.000Z' })],
        items: [item()]
      })
    })).toEqual({ state: 'available', asOf, score: 66, bucket: 'greed', observedAt: '2026-08-06T10:00:00.000Z' })
  })

  it('ignores malformed unrelated pipeline entries', () => {
    expect(queryFearGreedSnapshot({
      asOf,
      pipeline: pipeline({
        metrics: [null as never, metric({ actual: 66 })],
        items: [item()]
      })
    })).toEqual({ state: 'available', asOf, score: 66, bucket: 'greed', observedAt: '2026-08-06T10:00:00.000Z' })
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
