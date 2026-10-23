import { describe, expect, it } from 'vitest'

import { aggregateSentimentSignals, scoreSentimentSignal } from './sentimentScoring'
import type { SentimentSignalInput } from '../schema/intelligenceSentiment'

describe('sentimentScoring', () => {
  it('weights high-trust strong negative signals more than low-trust weak signals', () => {
    const now = Date.parse('2026-07-05T12:00:00.000Z')
    const highTrust = scoreSentimentSignal(
      baseSignal({
        trustLevel: 'high',
        sentimentLabel: 'negative',
        strength: 5,
        confidence: 90
      }),
      now
    )
    const lowTrust = scoreSentimentSignal(
      baseSignal({
        trustLevel: 'low',
        sentimentLabel: 'negative',
        strength: 2,
        confidence: 40
      }),
      now
    )

    expect(Math.abs(highTrust)).toBeGreaterThan(Math.abs(lowTrust))
  })

  it('excludes signals outside the selected horizon window', () => {
    const now = Date.parse('2026-07-05T12:00:00.000Z')
    const staleScore = scoreSentimentSignal(
      baseSignal({
        createdAt: '2026-07-05T11:00:00.000Z',
        horizon: '15m'
      }),
      now
    )

    expect(staleScore).toBe(0)
  })

  it('returns mixed label when positive and negative contributions are both material', () => {
    const now = Date.parse('2026-07-05T12:00:00.000Z')
    const aggregate = aggregateSentimentSignals(
      {
        scopeType: 'market-wide',
        scopeKey: 'global',
        horizon: '1h',
        signals: [
          baseSignal({ signalId: 's1', itemId: 'item-1', clusterId: 'cluster-1', sentimentLabel: 'positive', strength: 4 }),
          baseSignal({ signalId: 's2', itemId: 'item-2', clusterId: 'cluster-2', sentimentLabel: 'negative', strength: 4 })
        ]
      },
      now
    )

    expect(aggregate.aggregateLabel).toBe('mixed')
    expect(aggregate.supportingItemIdsJson).toContain('item-1')
    expect(aggregate.supportingClusterIdsJson).toContain('cluster-1')
  })

  it('clamps aggregate score to [-1, 1]', () => {
    const now = Date.parse('2026-07-05T12:00:00.000Z')
    const aggregate = aggregateSentimentSignals(
      {
        scopeType: 'market-wide',
        scopeKey: 'global',
        horizon: '1h',
        signals: Array.from({ length: 5 }, (_value, index) =>
          baseSignal({
            signalId: `s-${index}`,
            itemId: `item-${index}`,
            sentimentLabel: 'positive',
            strength: 5,
            confidence: 100
          })
        )
      },
      now
    )

    expect(aggregate.aggregateScore).toBeLessThanOrEqual(1)
    expect(aggregate.aggregateScore).toBeGreaterThanOrEqual(-1)
  })
})

function baseSignal(overrides: Partial<SentimentSignalInput> = {}): SentimentSignalInput {
  return {
    signalId: 'signal-1',
    itemId: 'item-1',
    clusterId: 'cluster-1',
    scopeType: 'market-wide',
    scopeKey: 'global',
    horizon: '1h',
    sourceGroup: 'mainstream-news',
    sentimentLabel: 'negative',
    strength: 3,
    confidence: 70,
    trustLevel: 'medium',
    createdAt: '2026-07-05T11:50:00.000Z',
    ...overrides
  }
}
