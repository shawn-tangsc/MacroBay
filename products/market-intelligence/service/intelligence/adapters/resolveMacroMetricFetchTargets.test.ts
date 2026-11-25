import { describe, expect, it } from 'vitest'

import { resolveMacroMetricFetchTargets } from './resolveMacroMetricFetchTargets'
import { macroAdapterConfigForSource } from '../application/macroSourceCatalogMetadata'
import type { IntelligenceSourceConfig } from '../schema/intelligenceSource'

function macroConfig(sourceId: 'bls-economic-series' | 'bea-economic-series' | 'fred-rates-liquidity' | 'treasury-fiscal-data'): IntelligenceSourceConfig {
  const adapterConfig = macroAdapterConfigForSource(sourceId)
  return {
    sourceId,
    sourceName: sourceId,
    sourceGroup: 'macro-regulation',
    adapterType: 'rest-api-poller',
    executionMode: 'polling',
    enabled: true,
    category: 'macro',
    trustLevel: 'high',
    language: 'en',
    collectionPreset: 'balanced',
    desiredRuntimeState: 'polling',
    parserStrategy: `${sourceId}-v1`,
    noisePolicy: 'balanced',
    scopePolicy: 'all',
    rawArchiveEnabled: true,
    retentionMode: 'balanced',
    autoReplayAfterParserUpgrade: true,
    adapterConfig
  }
}

describe('resolveMacroMetricFetchTargets', () => {
  it('builds one BLS POST request with configured series ids', () => {
    const targets = resolveMacroMetricFetchTargets(macroConfig('bls-economic-series'))
    expect(targets).toHaveLength(1)
    expect(targets[0]?.method).toBe('POST')
    expect(targets[0]?.url).toContain('bls.gov')
    const body = JSON.parse(targets[0]?.body ?? '{}') as { seriesid: string[] }
    expect(body.seriesid).toEqual(['CUSR0000SA0', 'CUSR0000SA0L1E', 'CES0000000001', 'LNS14000000'])
  })

  it('asks FRED for a whole trading year of closes, not the newest five rows', () => {
    const targets = resolveMacroMetricFetchTargets(macroConfig('fred-rates-liquidity'))
    const rateIds = [
      'DGS1MO', 'DGS3MO', 'DGS6MO', 'DGS1', 'DGS2', 'DGS3', 'DGS5', 'DGS7', 'DGS10', 'DGS20', 'DGS30',
      'DFII5', 'DFII7', 'DFII10', 'DFII20', 'DFII30', 'T5YIE', 'T10YIE', 'T5YIFR'
    ]
    const rates = targets.filter((target) => rateIds.includes(target.seriesId ?? ''))
    // 整条曲线：每一条都是一个请求，各自要整窗（19 条，一个都不能漏）。
    expect(rates.map((target) => target.seriesId)).toEqual(rateIds)
    for (const target of rates) {
      expect(new URL(target.url).searchParams.get('limit')).toBe('400')
    }
  })

  it('builds BEA requests with dataset/table/line parameters', () => {
    const targets = resolveMacroMetricFetchTargets(macroConfig('bea-economic-series'))
    expect(targets).toHaveLength(3)

    const gdp = targets.find((target) => target.metricKey === 'US_GDP_REAL_QOQ_ANNUALIZED')
    expect(gdp?.url).toContain('datasetname=NIPA')
    expect(gdp?.url).toContain('TableName=T10101')
    expect(gdp?.url).toContain('LineNumber=1')
    expect(gdp?.url).toContain('Frequency=Q')

    const pce = targets.find((target) => target.metricKey === 'US_PCE_CORE_YOY')
    expect(pce?.url).toContain('TableName=T20304')
    expect(pce?.url).toContain('LineNumber=25')
    expect(pce?.url).toContain('Frequency=M')
  })

  it('builds one FRED request per configured series', () => {
    const targets = resolveMacroMetricFetchTargets(macroConfig('fred-rates-liquidity'))
    expect(targets).toHaveLength(24)
    expect(targets.map((target) => target.seriesId)).toEqual([
      'DGS1MO', 'DGS3MO', 'DGS6MO', 'DGS1', 'DGS2', 'DGS3', 'DGS5', 'DGS7', 'DGS10', 'DGS20', 'DGS30',
      'DFII5', 'DFII7', 'DFII10', 'DFII20', 'DFII30', 'T5YIE', 'T10YIE', 'T5YIFR',
      'DTWEXBGS', 'WALCL', 'DFEDTARU', 'DFEDTARL', 'EFFR'
    ])
    for (const target of targets) {
      expect(target.url).toContain('series_id=')
      expect(target.url).toContain('file_type=json')
    }
  })

  it('builds Treasury requests with explicit fields, filters, and sort', () => {
    const targets = resolveMacroMetricFetchTargets(macroConfig('treasury-fiscal-data'))
    expect(targets).toHaveLength(3)

    const tga = targets.find((target) => target.metricKey === 'US_TGA_BALANCE')
    expect(tga?.url).toContain('operating_cash_balance')
    expect(tga?.url).toContain('fields=record_date')
    expect(tga?.url).toContain('close_today_bal')
    expect(tga?.url).toContain('account_type%3Aeq%3ATreasury+General+Account')
    expect(tga?.url).toContain('sort=-record_date')

    const deposits = targets.find((target) => target.metricKey === 'US_TGA_DEPOSITS')
    expect(deposits?.url).toContain('transaction_type%3Aeq%3ADeposits')
  })
})
