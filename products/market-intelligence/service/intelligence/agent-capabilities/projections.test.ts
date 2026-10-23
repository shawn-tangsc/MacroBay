import { describe, expect, it } from 'vitest'

import type { IntelligenceSourceProfile } from '../schema/intelligenceSource'
import {
  projectSourceDetail,
  projectSourceSummary,
  projectTimelineRow
} from './projections'

const profile: IntelligenceSourceProfile = {
  profileId: 'profile-internal-1',
  sourceId: 'fred-rates-liquidity',
  enabled: true,
  credentialRef: 'credential-internal-ref',
  collectionPreset: 'balanced',
  includeInSentiment: true,
  scopePolicy: 'watchlist-priority',
  rawArchiveEnabled: true,
  retentionMode: 'balanced',
  autoReplayAfterParserUpgrade: false,
  monitoredSymbols: ['BTCUSDT'],
  sourceSpecificConfigJson: '{"apiKey":"placeholder-value"}',
  updatedAt: '2026-10-01T00:00:00.000Z'
}

const definition = {
  sourceId: 'fred-rates-liquidity',
  displayName: 'FRED rates & liquidity',
  sourceGroup: 'official-source',
  category: 'macro',
  visibility: 'visible',
  authMode: 'api-key',
  sourceSpecificFields: ['apiKey'],
  readinessNote: 'Reads the official daily series.'
}

function serialize(value: unknown): string {
  return JSON.stringify(value)
}

describe('agent source projections', () => {
  it('never emits profileId, credentialRef, sourceSpecificConfigJson, or maskedPreview', () => {
    const summary = projectSourceSummary({ profile, definition })
    const serialized = serialize(summary)

    expect(serialized).not.toContain('credentialRef')
    expect(serialized).not.toContain('sourceSpecificConfigJson')
    expect(serialized).not.toContain('maskedPreview')
    expect(serialized).not.toContain('profileId')
    expect(serialized).not.toContain('placeholder-value')
    expect(summary.credentialStatus).toEqual({ hasCredential: true })
  })

  it('projects the detail view to the same whitelist plus the definition fields', () => {
    const detail = projectSourceDetail({
      definition,
      profile,
      credentialStatus: {
        hasCredential: true,
        maskedPreview: 'sk-masked-preview',
        lastValidatedAt: '2026-10-02T00:00:00.000Z'
      }
    })
    const serialized = serialize(detail)

    expect(serialized).not.toContain('credentialRef')
    expect(serialized).not.toContain('sourceSpecificConfigJson')
    expect(serialized).not.toContain('maskedPreview')
    expect(serialized).not.toContain('sk-masked-preview')
    expect(serialized).not.toContain('profileId')
    expect(detail.definition).toEqual({
      description: 'Reads the official daily series.',
      authMode: 'api-key',
      requiredFields: ['apiKey']
    })
    expect(detail.credentialStatus).toEqual({
      hasCredential: true,
      lastValidatedAt: '2026-10-02T00:00:00.000Z'
    })
  })

  it('drops internal row keys and the raw matcher output from timeline rows', () => {
    const row = {
      rowId: 'row-internal',
      clusterId: 'cluster-internal',
      itemId: 'item-1',
      sourceId: 'fred-rates-liquidity',
      sourceName: 'FRED',
      sourceGroup: 'official-source',
      eventType: 'macro',
      title: 'CPI released',
      symbols: ['BTCUSDT'],
      alertStatus: 'none',
      hasRevision: false,
      relevance: 'watchlist',
      match: { eventId: 'event-1', matchedSymbols: ['BTCUSDT'] },
      detectedAt: '2026-10-01T00:00:00.000Z'
    }
    const projected = projectTimelineRow(row as never) as Record<string, unknown>

    expect(projected).not.toHaveProperty('rowId')
    expect(projected).not.toHaveProperty('clusterId')
    expect(projected).not.toHaveProperty('match')
    expect(projected.itemId).toBe('item-1')
  })
})
