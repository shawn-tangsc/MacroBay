import { describe, expect, it } from 'vitest'

import {
  MARKET_INTELLIGENCE_QUERY_CAVEATS,
  MARKET_INTELLIGENCE_QUERY_SCHEMA_VERSION,
  MARKET_INTELLIGENCE_QUERY_TYPES,
  capitalConditionsSnapshotPolicy,
  etfPublicSnapshotPolicy,
  isWithinCapitalConditionsSnapshotDtoBudget,
  isValidEtfPublicSnapshot,
  isVisibleEtfPublicSnapshot,
  fearGreedSnapshotPolicy,
  isCanonicalCapitalConditionsSnapshotTime,
  isFundingRateHistoryRate,
  resolveFearGreedSnapshotBucket,
  type MarketIntelligenceQueryResult,
  type SentimentSnapshotData
} from './intelligenceQueryContracts'

describe('intelligenceQueryContracts', () => {
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

  it('owns the fixed Fear & Greed snapshot identity, bounds, and bucket policy', () => {
    expect(MARKET_INTELLIGENCE_QUERY_TYPES.fearGreedSnapshot).toBe('query_fear_greed_snapshot')
    expect(fearGreedSnapshotPolicy).toMatchObject({
      sourceId: 'alternative-fear-greed',
      metricKey: 'FEAR_GREED_INDEX',
      unavailableFailureCode: 'fear-greed-query-unavailable'
    })
    expect(resolveFearGreedSnapshotBucket(0)).toBe('extreme-fear')
    expect(resolveFearGreedSnapshotBucket(25)).toBe('fear')
    expect(resolveFearGreedSnapshotBucket(50)).toBe('neutral')
    expect(resolveFearGreedSnapshotBucket(51)).toBe('greed')
    expect(resolveFearGreedSnapshotBucket(100)).toBe('extreme-greed')
    expect(resolveFearGreedSnapshotBucket(101)).toBeUndefined()
  })

  it('guards funding-rate history values to finite percentages', () => {
    expect(isFundingRateHistoryRate(-100)).toBe(true)
    expect(isFundingRateHistoryRate(100)).toBe(true)
    expect(isFundingRateHistoryRate(Number.NaN)).toBe(false)
    expect(isFundingRateHistoryRate(100.001)).toBe(false)
  })

  it('owns the capital-conditions snapshot freshness and redacted query contract', () => {
    expect(MARKET_INTELLIGENCE_QUERY_TYPES.capitalConditionsSnapshot).toBe('query_capital_conditions_snapshot')
    expect(capitalConditionsSnapshotPolicy).toMatchObject({
      sourceId: 'defillama-stablecoins',
      maximumAgeMs: 6 * 60 * 60 * 1_000,
      maximumDtoBytes: 12 * 1024,
      unavailableFailureCode: 'capital-conditions-query-unavailable'
    })
    expect(isWithinCapitalConditionsSnapshotDtoBudget({ safe: 'x'.repeat(capitalConditionsSnapshotPolicy.maximumDtoBytes - 16) })).toBe(true)
    expect(isWithinCapitalConditionsSnapshotDtoBudget({ unsafe: 'x'.repeat(capitalConditionsSnapshotPolicy.maximumDtoBytes) })).toBe(false)
    expect(isCanonicalCapitalConditionsSnapshotTime('2026-08-18T00:00:00.000Z')).toBe(true)
    expect(isCanonicalCapitalConditionsSnapshotTime('2026-08-18T00:00:00Z')).toBe(false)
  })

  it('owns the fixed, bounded ETF public DTO contract and rejects an extended provider shape', () => {
    const snapshot = safeEtfPublicSnapshot()
    expect(etfPublicSnapshotPolicy).toMatchObject({ sourceId: '0xrouter', maximumRowsPerAsset: 30, maximumDtoBytes: 12 * 1024 })
    expect(isValidEtfPublicSnapshot(snapshot)).toBe(true)
    expect(isValidEtfPublicSnapshot({ ...snapshot, providerMetadata: 'secret' })).toBe(false)
    expect(isValidEtfPublicSnapshot({ ...snapshot, btc: { ...snapshot.btc, asset: 'ETH' } })).toBe(false)
    expect(isValidEtfPublicSnapshot({ ...snapshot, btc: { ...snapshot.btc, rows: [...snapshot.btc.rows, snapshot.btc.rows[4]!] } })).toBe(false)
    expect(isValidEtfPublicSnapshot({ ...snapshot, btc: { ...snapshot.btc, rows: Object.assign([...snapshot.btc.rows], { providerMetadata: 'secret' }) } })).toBe(false)
    expect(isValidEtfPublicSnapshot({ ...snapshot, btc: { ...snapshot.btc, rows: Array.from({ length: 31 }, (_, index) => ({ tradingDate: `2026-09-${String(index + 1).padStart(2, '0')}`, netFlowUsd: index, observedAt: snapshot.verifiedAt })) } })).toBe(false)
    expect(isVisibleEtfPublicSnapshot(snapshot, '2026-08-08T10:00:00.000Z')).toBe(true)
    expect(isVisibleEtfPublicSnapshot(snapshot, '2026-08-08T10:00:00.001Z')).toBe(false)
  })
})

function safeEtfPublicSnapshot() {
  const dates = ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05']
  const observedAt = '2026-08-06T10:00:00.000Z'
  return {
    state: 'available' as const, schemaVersion: 1, sourceId: '0xrouter' as const, windowEnd: '2026-08-05', verifiedAt: observedAt,
    btc: { asset: 'BTC' as const, rows: dates.map((tradingDate, index) => ({ tradingDate, netFlowUsd: index + 1, observedAt })) },
    eth: { asset: 'ETH' as const, rows: dates.map((tradingDate, index) => ({ tradingDate, netFlowUsd: -(index + 1), observedAt })) }
  }
}
