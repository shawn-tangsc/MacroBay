import { describe, expect, it } from 'vitest'

import { getIntelligenceSourceDefinition } from '../application/sourceCatalog'
import type { RuntimeStateRecord } from '@platform/jobs'

import type { IntelligenceSourceDefinition } from '../schema/intelligenceSource'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import { MARKET_INTELLIGENCE_QUERY_CAVEATS } from './queryContracts'
import { buildSourceCoverageAsOf } from './sourceCoverageAsOf'

function definition(overrides: Partial<IntelligenceSourceDefinition> = {}): IntelligenceSourceDefinition {
  return {
    sourceId: 'binance-announcements',
    displayName: 'Binance Announcements',
    sourceGroup: 'exchange-announcement',
    adapterType: 'html-page-poller',
    category: 'exchange-announcement',
    defaultScopePolicy: 'watchlist-priority',
    parserStrategy: 'binance-announcements-v1',
    readiness: 'live',
    ...overrides
  } as IntelligenceSourceDefinition
}

function runtimeState(overrides: Partial<RuntimeStateRecord> = {}): RuntimeStateRecord {
  return {
    owner: 'product',
    productId: 'market-intelligence',
    resourceId: 'binance-announcements',
    status: 'idle',
    consecutiveFailures: 0,
    updatedAt: '2026-07-08T09:00:00.000Z',
    lastSuccessAt: '2026-07-08T09:00:00.000Z',
    ...overrides
  }
}

describe('sourceCoverageAsOf', () => {
  const asOf = '2026-07-08T10:00:00.000Z'

  it('marks live sources fresh when latest success is before asOf and recent', () => {
    const coverage = buildSourceCoverageAsOf({
      definitions: [definition()],
      runtimeStates: [runtimeState()],
      items: [],
      asOf
    })

    expect(coverage[0]?.productionState).toBe('fresh')
  })

  it('marks sources stale when latest success is too old relative to asOf', () => {
    const coverage = buildSourceCoverageAsOf({
      definitions: [definition()],
      runtimeStates: [
        runtimeState({
          lastSuccessAt: '2026-07-07T00:00:00.000Z',
          updatedAt: '2026-07-07T00:00:00.000Z'
        })
      ],
      items: [],
      asOf
    })

    expect(coverage[0]?.productionState).toBe('stale')
    expect(coverage[0]?.caveats).toContain(MARKET_INTELLIGENCE_QUERY_CAVEATS.sourceStale)
  })

  it('uses failures visible before asOf and ignores health updated after asOf', () => {
    const coverage = buildSourceCoverageAsOf({
      definitions: [definition()],
      runtimeStates: [
        runtimeState({
          lastSuccessAt: '2026-07-08T09:00:00.000Z',
          lastFailureAt: '2026-07-08T09:30:00.000Z',
          updatedAt: '2026-07-08T11:00:00.000Z',
          status: 'failed',
          consecutiveFailures: 2
        })
      ],
      items: [],
      asOf
    })

    expect(coverage[0]?.productionState).toBe('failed')
    expect(coverage[0]?.caveats).toContain(MARKET_INTELLIGENCE_QUERY_CAVEATS.sourceFailedBeforeAsOf)
    expect(coverage[0]?.caveats).toContain(MARKET_INTELLIGENCE_QUERY_CAVEATS.sourceStale)
  })

  it('marks fixture-ready and planned sources appropriately', () => {
    const coverage = buildSourceCoverageAsOf({
      definitions: [
        definition({ sourceId: 'fixture-source', readiness: 'fixture-ready' }),
        definition({ sourceId: 'planned-source', readiness: 'planned' })
      ],
      runtimeStates: [],
      items: [],
      asOf
    })

    expect(coverage.find((entry) => entry.sourceId === 'fixture-source')?.productionState).toBe('fixture-only')
    expect(coverage.find((entry) => entry.sourceId === 'planned-source')?.productionState).toBe('planned')
  })

  it('tracks latest visible item timestamp per source', () => {
    const items: IntelligenceItem[] = [
      {
        itemId: 'item-1',
        primaryRawRecordId: 'raw-1',
        canonicalDedupeKey: 'dedupe-1',
        sourceId: 'binance-announcements',
        eventType: 'listing',
        title: 'Listing',
        sourceCategory: 'exchange-announcement',
        sourceTrust: 'high',
        detectedAt: '2026-07-08T09:30:00.000Z',
        timelineStatus: 'evaluated',
        normalizerVersion: 'v1'
      }
    ]

    const coverage = buildSourceCoverageAsOf({
      definitions: [definition()],
      runtimeStates: [runtimeState()],
      items,
      asOf
    })

    expect(coverage[0]?.latestVisibleItemAt).toBe('2026-07-08T09:30:00.000Z')
  })

  it('uses macro cadence freshness windows instead of the default 6h ticker rule', () => {
    const asOf = '2026-07-08T10:00:00.000Z'
    const treasury = {
      ...getIntelligenceSourceDefinition('treasury-fiscal-data')!,
      readiness: 'live' as const
    }
    const recentSuccess = '2026-07-07T10:00:00.000Z'
    const staleSuccess = '2026-05-01T10:00:00.000Z'

    const freshCoverage = buildSourceCoverageAsOf({
      definitions: [treasury],
      runtimeStates: [runtimeState({ resourceId: treasury.sourceId, lastSuccessAt: recentSuccess })],
      items: [],
      asOf,
      enabledSourceIds: new Set([treasury.sourceId])
    })
    expect(freshCoverage[0]?.productionState).toBe('fresh')

    const staleCoverage = buildSourceCoverageAsOf({
      definitions: [treasury],
      runtimeStates: [runtimeState({ resourceId: treasury.sourceId, lastSuccessAt: staleSuccess })],
      items: [],
      asOf,
      enabledSourceIds: new Set([treasury.sourceId])
    })
    expect(staleCoverage[0]?.productionState).toBe('stale')
    expect(staleCoverage[0]?.caveats).toContain('source-stale')
  })
})
