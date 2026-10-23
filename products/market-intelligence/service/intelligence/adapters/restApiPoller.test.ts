import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseKrakenSystemStatus, restApiPollerAdapter } from './restApiPoller'

describe('restApiPollerAdapter', () => {
  it('normalizes kraken system status payloads', () => {
    const fixture = loadFixture('kraken-system-status.json')
    const parsed = parseKrakenSystemStatus(JSON.parse(fixture))
    expect(parsed.title).toContain('Spot Trading')

    const normalized = restApiPollerAdapter.normalizeParsedItem({
      config: config(),
      parsed,
      rawRecordId: 'raw-1',
      detectedAt: '2026-07-05T10:00:00.000Z'
    })

    expect(normalized.clusterType).toBe('incident')
    expect(normalized.canonicalDedupeKey).toContain('rest:kraken-system-status:')
  })
})

function config() {
  return {
    sourceId: 'kraken-system-status',
    sourceName: 'Kraken SystemStatus',
    sourceGroup: 'exchange-status' as const,
    adapterType: 'rest-api-poller' as const,
    executionMode: 'polling' as const,
    enabled: true,
    category: 'exchange-status' as const,
    trustLevel: 'high' as const,
    language: 'en',
    collectionPreset: 'frequent' as const,
    desiredRuntimeState: 'polling' as const,
    parserStrategy: 'kraken-system-status-v1',
    noisePolicy: 'balanced' as const,
    includeInSentiment: true,
    scopePolicy: 'active-position-priority' as const,
    rawArchiveEnabled: true,
    retentionMode: 'balanced' as const,
    autoReplayAfterParserUpgrade: true,
    sentimentEligible: true,
    adapterConfig: {}
  }
}

function loadFixture(name: string): string {
  return readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')
}
