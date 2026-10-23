import { describe, expect, it } from 'vitest'

import { parseBlsEconomicSeriesPayload } from './blsEconomicSeriesParser'

const config = {
  sourceId: 'bls-economic-series',
  sourceName: 'BLS Economic Series',
  sourceGroup: 'macro-regulation',
  adapterType: 'rest-api-poller',
  executionMode: 'polling',
  enabled: true,
  category: 'macro',
  trustLevel: 'high',
  language: 'en',
  collectionPreset: 'balanced',
  desiredRuntimeState: 'polling',
  parserStrategy: 'bls-economic-series-v1',
  noisePolicy: 'balanced',
  includeInSentiment: true,
  scopePolicy: 'all',
  rawArchiveEnabled: true,
  retentionMode: 'balanced',
  autoReplayAfterParserUpgrade: true,
  sentimentEligible: true,
  adapterConfig: {}
} as const

describe('parseBlsEconomicSeriesPayload', () => {
  it('computes CPI YoY from index observations instead of treating levels as percentages', () => {
    const drafts = parseBlsEconomicSeriesPayload(
      {
        Results: {
          series: [
            {
              seriesID: 'CUSR0000SA0',
              data: [
                { year: '2026', period: 'M06', value: '310.500' },
                { year: '2025', period: 'M06', value: '300.000' },
                { year: '2026', period: 'M05', value: '309.000' },
                { year: '2025', period: 'M05', value: '299.500' }
              ]
            }
          ]
        }
      },
      config
    )

    expect(drafts[0]?.metricKey).toBe('US_CPI_HEADLINE_YOY')
    expect(drafts[0]?.actual).toBeCloseTo(3.5, 2)
    expect(drafts[0]?.previous).toBeCloseTo(3.172, 2)
    expect(drafts[0]?.unit).toBe('percent')
    expect(drafts[0]?.comparisonBasis).toBe('actual-vs-previous')
    expect(drafts[0]?.surpriseDirection).toBe('above')
  })

  it('computes NFP as monthly payroll change instead of employment level', () => {
    const drafts = parseBlsEconomicSeriesPayload(
      {
        Results: {
          series: [
            {
              seriesID: 'CES0000000001',
              data: [
                { year: '2026', period: 'M06', value: '158000' },
                { year: '2026', period: 'M05', value: '157820' },
                { year: '2026', period: 'M04', value: '157600' }
              ]
            }
          ]
        }
      },
      config
    )

    expect(drafts[0]?.metricKey).toBe('US_PAYROLLS_NFP')
    expect(drafts[0]?.actual).toBe(180)
    expect(drafts[0]?.comparisonBasis).toBe('period-change')
    expect(drafts[0]?.unit).toBe('thousands')
  })

  it('uses configured BLS release calendar instead of observation month-end', () => {
    const drafts = parseBlsEconomicSeriesPayload(
      {
        Results: {
          series: [
            {
              seriesID: 'LNS14000000',
              data: [
                { year: '2026', period: 'M06', value: '4.1' },
                { year: '2026', period: 'M05', value: '4.0' }
              ]
            }
          ]
        }
      },
      config
    )

    expect(drafts[0]?.releaseTime).toBe('2026-07-03T12:30:00.000Z')
    expect(drafts[0]?.releaseTime).not.toBe('2026-06-30T00:00:00.000Z')
    expect(JSON.parse(drafts[0]?.rawValueJson ?? '{}')).toMatchObject({
      releaseCalendarCaveat: 'derived-release-calendar'
    })
  })

  it('skips CPI metrics when year-ago history is missing', () => {
    expect(() =>
      parseBlsEconomicSeriesPayload(
        {
          Results: {
            series: [
              {
                seriesID: 'CUSR0000SA0',
                data: [{ year: '2026', period: 'M06', value: '310.500' }]
              }
            ]
          }
        },
        config
      )
    ).toThrow(/no series observations found/)
  })
})
