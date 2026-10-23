import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseFredRatesLiquidityPayload } from './fredRatesLiquidityParser'

const config = {
  sourceId: 'fred-rates-liquidity',
  sourceName: 'FRED Rates & Liquidity',
  sourceGroup: 'macro-regulation',
  adapterType: 'rest-api-poller',
  executionMode: 'polling',
  enabled: true,
  category: 'macro',
  trustLevel: 'high',
  language: 'en',
  collectionPreset: 'balanced',
  desiredRuntimeState: 'polling',
  parserStrategy: 'fred-rates-liquidity-v1',
  noisePolicy: 'balanced',
  includeInSentiment: true,
  scopePolicy: 'all',
  rawArchiveEnabled: true,
  retentionMode: 'balanced',
  autoReplayAfterParserUpgrade: true,
  sentimentEligible: true,
  adapterConfig: {}
} as const

describe('parseFredRatesLiquidityPayload', () => {
  it('parses rising yield observations with up surprise direction', () => {
    const drafts = parseFredRatesLiquidityPayload(loadFixture('fred-yields-rising-sample.json'), config, 'DGS10')
    expect(drafts[0]?.metricKey).toBe('US_10Y_YIELD')
    expect(drafts[0]?.actual).toBe(4.52)
    expect(drafts[0]?.surpriseDirection).toBe('up')
    expect(drafts[0]?.releaseTime).toBe('2026-07-03T00:00:00.000Z')
  })

  it('parses falling yield observations with down surprise direction', () => {
    const drafts = parseFredRatesLiquidityPayload(loadFixture('fred-yields-falling-sample.json'), config, 'DGS10')
    expect(drafts[0]?.surpriseDirection).toBe('down')
  })

  it('ignores missing-value markers safely', () => {
    expect(() =>
      parseFredRatesLiquidityPayload(
        { observations: [{ date: '2026-07-03', value: '.' }] },
        config,
        'DGS10'
      )
    ).toThrow(/no usable observations/)
  })

  // The three traps the sample body carries: `value` is a string
  // that may be the FRED sentinel `.`, it may arrive without a leading zero, and it exists only for
  // days the market was open — so the observation date is the only honest timestamp.
  it('reads a DGS10 sample body, keeping the observation date and the prior trading day', () => {
    const drafts = parseFredRatesLiquidityPayload(loadFixture('fred-dgs10-real-observations-sample.json'), config, 'DGS10')

    expect(drafts[0]).toMatchObject({
      metricKey: 'US_10Y_YIELD',
      actual: 4.25,
      previous: 4.23,
      unit: 'percent',
      period: '2026-10-09'
    })
    expect(drafts[0]?.releaseTime).toBe('2026-10-09T00:00:00.000Z')
    expect(drafts[0]?.surpriseDirection).toBe('up')
    expect(drafts[0]?.surpriseMagnitude).toBeCloseTo(0.02, 10)
  })

  it('skips the `.` sentinel instead of parsing it, and keeps the last observation', () => {
    const drafts = parseFredRatesLiquidityPayload(loadFixture('fred-t10yie-real-observations-sample.json'), config, 'T10YIE')

    expect(drafts[0]?.metricKey).toBe('US_10Y_BREAKEVEN_INFLATION')
    expect(drafts[0]?.actual).toBe(2.10)
    expect(drafts[0]?.period).toBe('2026-10-13')
    // The sentinel day is not a previous value: 10-12 was a holiday, not a 0.
    expect(drafts[0]?.previous).toBeUndefined()
  })

  it('reads a value without a leading zero as a number', () => {
    const drafts = parseFredRatesLiquidityPayload(
      { observations: [{ date: '2026-10-09', value: '4.8' }] },
      config,
      'DGS2'
    )

    expect(drafts[0]?.actual).toBe(4.8)
    expect(drafts[0]?.metricKey).toBe('US_2Y_YIELD')
    expect(drafts[0]?.period).toBe('2026-10-09')
  })

  it.each([
    ['a padded sentinel', ' . '],
    ['an empty value', ''],
    ['a non-numeric value', 'not-a-number']
  ])('ignores %s and a row with no observation date', (_name, value) => {
    const drafts = parseFredRatesLiquidityPayload(
      {
        observations: [
          { date: '2026-10-09', value: '5.24' },
          { date: '2026-10-08', value },
          { value: '5.00' }
        ]
      },
      config,
      'DGS10'
    )

    expect(drafts[0]?.actual).toBe(5.24)
    expect(drafts[0]?.period).toBe('2026-10-09')
    expect(drafts[0]?.previous).toBeUndefined()
  })

  it('reads a padded number as the number it is', () => {
    const drafts = parseFredRatesLiquidityPayload(
      { observations: [{ date: '2026-10-09', value: '5.24' }, { date: '2026-10-08', value: ' 5.20 ' }] },
      config,
      'DGS10'
    )

    expect(drafts[0]?.previous).toBe(5.2)
  })

  it('parses balance-sheet expansion observations', () => {
    const drafts = parseFredRatesLiquidityPayload(
      loadFixture('fred-balance-sheet-expansion-sample.json'),
      config,
      'WALCL'
    )
    expect(drafts[0]?.metricKey).toBe('FED_BALANCE_SHEET')
    expect(drafts[0]?.metricKind).toBe('liquidity')
    expect(drafts[0]?.surpriseDirection).toBe('up')
  })
})

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(__dirname, '../fixtures', name), 'utf8'))
}
