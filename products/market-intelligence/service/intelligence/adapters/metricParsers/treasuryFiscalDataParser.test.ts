import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseTreasuryFiscalDataPayload } from './treasuryFiscalDataParser'

const config = {
  sourceId: 'treasury-fiscal-data',
  sourceName: 'Treasury Fiscal Data',
  sourceGroup: 'macro-regulation',
  adapterType: 'rest-api-poller',
  executionMode: 'polling',
  enabled: true,
  category: 'macro',
  trustLevel: 'high',
  language: 'en',
  collectionPreset: 'balanced',
  desiredRuntimeState: 'polling',
  parserStrategy: 'treasury-fiscal-data-v1',
  noisePolicy: 'balanced',
  includeInSentiment: true,
  scopePolicy: 'all',
  rawArchiveEnabled: true,
  retentionMode: 'balanced',
  autoReplayAfterParserUpgrade: true,
  sentimentEligible: true,
  adapterConfig: {}
} as const

describe('parseTreasuryFiscalDataPayload', () => {
  it('parses rising TGA balance with explicit millions-usd unit metadata', () => {
    const drafts = parseTreasuryFiscalDataPayload(loadFixture('treasury-tga-rising-sample.json'), config, 'US_TGA_BALANCE')
    expect(drafts[0]?.metricKey).toBe('US_TGA_BALANCE')
    expect(drafts[0]?.actual).toBe(780000)
    expect(drafts[0]?.unit).toBe('millions-usd')
    expect(drafts[0]?.rawValueJson).toContain('"proxy":true')
  })

  it('parses falling TGA balance with down surprise direction', () => {
    const drafts = parseTreasuryFiscalDataPayload(loadFixture('treasury-tga-falling-sample.json'), config, 'US_TGA_BALANCE')
    expect(drafts[0]?.surpriseDirection).toBe('down')
  })

  it('throws on empty filtered result sets', () => {
    expect(() =>
      parseTreasuryFiscalDataPayload(loadFixture('treasury-empty-filtered-sample.json'), config, 'US_TGA_BALANCE')
    ).toThrow(/empty filtered result set/)
  })
})

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(__dirname, '../fixtures', name), 'utf8'))
}
