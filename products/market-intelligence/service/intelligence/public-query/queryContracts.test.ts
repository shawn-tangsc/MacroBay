import { describe, expect, it } from 'vitest'

import {
  MARKET_INTELLIGENCE_QUERY_CAVEATS,
  MARKET_INTELLIGENCE_QUERY_SCHEMA_VERSION,
  MARKET_INTELLIGENCE_QUERY_TYPES,
  type MarketIntelligenceQueryResult,
  type SentimentSnapshotData
} from './queryContracts'

describe('queryContracts', () => {
  it('exports stable query schema version and query type constants', () => {
    expect(MARKET_INTELLIGENCE_QUERY_SCHEMA_VERSION).toBe(1)
    expect(MARKET_INTELLIGENCE_QUERY_TYPES.sentimentSnapshot).toBe('query_sentiment_snapshot')
    expect(MARKET_INTELLIGENCE_QUERY_CAVEATS.sentimentNotComputedAsOf).toBe('sentiment-not-computed-as-of')
  })

  it('allows assigning a typed query envelope without any', () => {
    const envelope: MarketIntelligenceQueryResult<SentimentSnapshotData> = {
      schemaVersion: MARKET_INTELLIGENCE_QUERY_SCHEMA_VERSION,
      queryId: 'query-1',
      queryType: MARKET_INTELLIGENCE_QUERY_TYPES.sentimentSnapshot,
      asOf: '2026-07-08T10:00:00.000Z',
      servedAt: '2026-07-08T10:01:00.000Z',
      resultHash: 'abc123',
      scope: { symbol: 'BTCUSDT' },
      timeWindow: { to: '2026-07-08T10:00:00.000Z' },
      confidence: 0,
      caveats: [MARKET_INTELLIGENCE_QUERY_CAVEATS.sentimentNotComputedAsOf],
      sourceCoverage: [],
      evidenceRefs: [],
      data: {
        status: 'unknown',
        scopeType: 'symbol',
        scopeKey: 'BTCUSDT',
        horizon: '1h',
        supportingImpactCount: 0,
        supportingItemCount: 0,
        supportingClusterCount: 0
      }
    }

    expect(envelope.data.status).toBe('unknown')
  })
})
