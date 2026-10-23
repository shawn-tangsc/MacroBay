import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseBeaEconomicSeriesPayload } from './beaEconomicSeriesParser'

const config = {
  sourceId: 'bea-economic-series',
  sourceName: 'BEA Economic Series',
  sourceGroup: 'macro-regulation',
  adapterType: 'rest-api-poller',
  executionMode: 'polling',
  enabled: true,
  category: 'macro',
  trustLevel: 'high',
  language: 'en',
  collectionPreset: 'balanced',
  desiredRuntimeState: 'polling',
  parserStrategy: 'bea-economic-series-v1',
  noisePolicy: 'balanced',
  includeInSentiment: true,
  scopePolicy: 'all',
  rawArchiveEnabled: true,
  retentionMode: 'balanced',
  autoReplayAfterParserUpgrade: true,
  sentimentEligible: true,
  adapterConfig: {}
} as const

describe('parseBeaEconomicSeriesPayload', () => {
  it('parses hot PCE fixture into inflation metric drafts', () => {
    const drafts = parseBeaEconomicSeriesPayload(loadFixture('bea-pce-hot-sample.json'), config)
    expect(drafts[0]?.metricKey).toBe('US_PCE_HEADLINE_YOY')
    expect(drafts[0]?.actual).toBe(3.6)
    expect(drafts[0]?.previous).toBe(3.1)
    expect(drafts[0]?.metricKind).toBe('inflation')
  })

  it('parses cooling PCE fixture with below surprise direction', () => {
    const drafts = parseBeaEconomicSeriesPayload(loadFixture('bea-pce-cooling-sample.json'), config)
    expect(drafts[0]?.actual).toBe(2.4)
    expect(drafts[0]?.surpriseDirection).toBe('below')
  })

  it('parses weak GDP fixture into growth metric draft', () => {
    const drafts = parseBeaEconomicSeriesPayload(loadFixture('bea-gdp-weak-sample.json'), config)
    expect(drafts[0]?.metricKey).toBe('US_GDP_REAL_QOQ_ANNUALIZED')
    expect(drafts[0]?.metricKind).toBe('growth')
    expect(drafts[0]?.surpriseDirection).toBe('below')
  })

  it('fails safely on inactive-user style API errors', () => {
    expect(() =>
      parseBeaEconomicSeriesPayload(
        {
          BEAAPI: {
            Results: {
              Error: { APIErrorDescription: 'Invalid UserID' }
            }
          }
        },
        config
      )
    ).toThrow(/Invalid UserID/)
  })

  it('fails safely on empty result sets', () => {
    expect(() => parseBeaEconomicSeriesPayload({ BEAAPI: { Results: { Data: [] } } }, config)).toThrow(
      /empty result set/
    )
  })
})

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(__dirname, '../fixtures', name), 'utf8'))
}
