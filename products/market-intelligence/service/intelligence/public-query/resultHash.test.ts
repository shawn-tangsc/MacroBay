import { describe, expect, it } from 'vitest'

import {
  MARKET_INTELLIGENCE_QUERY_SCHEMA_VERSION,
  MARKET_INTELLIGENCE_QUERY_TYPES
} from './queryContracts'
import { buildQueryResultHash } from './resultHash'

function stableInput() {
  return {
    schemaVersion: MARKET_INTELLIGENCE_QUERY_SCHEMA_VERSION,
    queryType: MARKET_INTELLIGENCE_QUERY_TYPES.sentimentSnapshot,
    asOf: '2026-07-08T10:00:00.000Z',
    scope: { symbol: 'BTCUSDT' },
    timeWindow: { to: '2026-07-08T10:00:00.000Z' },
    confidence: 0.8,
    caveats: [] as const,
    sourceCoverage: [],
    evidenceRefs: [],
    data: { status: 'unknown' as const }
  }
}

describe('resultHash', () => {
  it('produces the same hash for the same stable payload', () => {
    const left = buildQueryResultHash(stableInput())
    const right = buildQueryResultHash(stableInput())
    expect(left).toBe(right)
  })

  it('excludes queryId from the hash input', () => {
    expect(buildQueryResultHash(stableInput())).toBe(buildQueryResultHash(stableInput()))
  })

  it('changes when data or evidence refs change', () => {
    const base = buildQueryResultHash(stableInput())
    const changedData = buildQueryResultHash({
      ...stableInput(),
      data: { status: 'available' as const, score: 0.5 }
    })
    const changedEvidence = buildQueryResultHash({
      ...stableInput(),
      evidenceRefs: [
        {
          evidenceRefId: 'evidence-1',
          sourceId: 'binance-announcements',
          schemaVersion: 1,
          detectedAt: '2026-07-08T09:00:00.000Z',
          visibleAt: '2026-07-08T09:00:00.000Z',
          rendererSafeSummary: 'Listing update',
          caveats: []
        }
      ]
    })

    expect(changedData).not.toBe(base)
    expect(changedEvidence).not.toBe(base)
  })
})
