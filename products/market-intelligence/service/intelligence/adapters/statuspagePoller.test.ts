import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildStatuspageClusterKey } from '../application/clusterResolver'
import { parseStatuspageIncidents, statuspagePollerAdapter } from './statuspagePoller'

describe('statuspagePollerAdapter', () => {
  it('parses incidents and incident updates', () => {
    const fixture = loadFixture('statuspage-incidents.json')
    const incidents = parseStatuspageIncidents(fixture)
    expect(incidents).toHaveLength(1)

    const parsed = statuspagePollerAdapter.parseRawRecord({
      config: config(),
      rawRecord: {
        sourceId: 'coinbase-status',
        runId: 'run-1',
        payloadFormat: 'json',
        payloadRefType: 'inline',
        payloadBody: fixture,
        payloadHash: 'hash',
        sourceDedupeKey: 'dedupe',
        parserVersion: 'statuspage-v1'
      }
    })

    expect(parsed.vendorIncidentId).toBe('inc-100')
    expect(parsed.sourceMeta?.incidentStatus).toBe('investigating')
    expect(buildStatuspageClusterKey('inc-100')).toBe('statuspage:inc-100')
  })

  it('throws when no incidents are present', () => {
    expect(() =>
      statuspagePollerAdapter.parseRawRecord({
        config: config(),
        rawRecord: {
          sourceId: 'coinbase-status',
          runId: 'run-1',
          payloadFormat: 'json',
          payloadRefType: 'inline',
          payloadBody: '{"incidents":[]}',
          payloadHash: 'hash',
          sourceDedupeKey: 'dedupe-empty',
          parserVersion: 'statuspage-v1'
        }
      })
    ).toThrow(/No statuspage incidents/)
  })

  it('preserves resolved incident status in source meta', () => {
    const fixture = JSON.stringify({
      incidents: [
        {
          id: 'inc-200',
          name: 'Trading restored',
          status: 'resolved',
          created_at: '2026-07-05T12:00:00.000Z',
          incident_updates: [{ body: 'Incident resolved.', created_at: '2026-07-05T12:30:00.000Z', status: 'resolved' }]
        }
      ]
    })
    const parsed = statuspagePollerAdapter.parseRawRecord({
      config: config(),
      rawRecord: {
        sourceId: 'coinbase-status',
        runId: 'run-1',
        payloadFormat: 'json',
        payloadRefType: 'inline',
        payloadBody: fixture,
        payloadHash: 'hash',
        sourceDedupeKey: 'dedupe-resolved',
        parserVersion: 'statuspage-v1'
      }
    })
    expect(parsed.sourceMeta?.incidentStatus).toBe('resolved')
    expect(parsed.severityHint).toBe('info')
  })
})

function config() {
  return {
    sourceId: 'coinbase-status',
    sourceName: 'Coinbase Status',
    sourceGroup: 'exchange-status' as const,
    adapterType: 'statuspage-poller' as const,
    executionMode: 'polling' as const,
    enabled: true,
    category: 'exchange-status' as const,
    trustLevel: 'high' as const,
    language: 'en',
    collectionPreset: 'frequent' as const,
    desiredRuntimeState: 'polling' as const,
    parserStrategy: 'statuspage-v1',
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
