import { describe, expect, it } from 'vitest'

import {
  BEA_MACRO_SERIES,
  BLS_MACRO_SERIES,
  FRED_MACRO_SERIES,
  MACRO_SOURCE_IDS,
  TREASURY_MACRO_ENDPOINTS,
  macroAdapterConfigForSource
} from './macroSourceCatalogMetadata'

describe('macroSourceCatalogMetadata', () => {
  it('locks BLS provider series ids from design cards', () => {
    const ids = BLS_MACRO_SERIES.map((row) => row.providerSeriesId)
    expect(ids).toEqual(['CUSR0000SA0', 'CUSR0000SA0L1E', 'CES0000000001', 'LNS14000000'])
    expect(BLS_MACRO_SERIES.find((row) => row.key === 'US_CPI_HEADLINE_YOY')?.comparisonBasis).toBe(
      'actual-vs-previous'
    )
    expect(BLS_MACRO_SERIES.find((row) => row.key === 'US_PAYROLLS_NFP')?.comparisonBasis).toBe('period-change')
  })

  it('locks BEA NIPA dataset/table/line mappings', () => {
    const gdp = BEA_MACRO_SERIES.find((row) => row.key === 'US_GDP_REAL_QOQ_ANNUALIZED')
    expect(gdp).toMatchObject({ dataset: 'NIPA', table: 'T10101', lineCode: '1', frequency: 'quarterly' })

    const pceCore = BEA_MACRO_SERIES.find((row) => row.key === 'US_PCE_CORE_YOY')
    expect(pceCore).toMatchObject({ dataset: 'NIPA', table: 'T20304', lineCode: '25', frequency: 'monthly' })
  })

  it('locks FRED series ids for rates and liquidity', () => {
    const ids = FRED_MACRO_SERIES.map((row) => row.providerSeriesId)
    // 整条曲线 19 条（由登记表派生）＋ 5 条非曲线宏观指标。
    expect(ids).toEqual([
      'DGS1MO', 'DGS3MO', 'DGS6MO', 'DGS1', 'DGS2', 'DGS3', 'DGS5', 'DGS7', 'DGS10', 'DGS20', 'DGS30',
      'DFII5', 'DFII7', 'DFII10', 'DFII20', 'DFII30', 'T5YIE', 'T10YIE', 'T5YIFR',
      'DTWEXBGS', 'WALCL', 'DFEDTARU', 'DFEDTARL', 'EFFR'
    ])
    // 名义曲线 11 档，供应商代码与内部键一一对上；实际利率与通胀预期另归各自的 kind。
    const tenors = FRED_MACRO_SERIES.filter((row) => row.metricKind === 'treasury-yield')
    expect(tenors.map((row) => [row.providerSeriesId, row.key])).toEqual([
      ['DGS1MO', 'US_1M_YIELD'], ['DGS3MO', 'US_3M_YIELD'], ['DGS6MO', 'US_6M_YIELD'],
      ['DGS1', 'US_1Y_YIELD'], ['DGS2', 'US_2Y_YIELD'], ['DGS3', 'US_3Y_YIELD'],
      ['DGS5', 'US_5Y_YIELD'], ['DGS7', 'US_7Y_YIELD'], ['DGS10', 'US_10Y_YIELD'],
      ['DGS20', 'US_20Y_YIELD'], ['DGS30', 'US_30Y_YIELD']
    ])
    expect(FRED_MACRO_SERIES.filter((row) => row.metricKind === 'rate').map((row) => row.providerSeriesId))
      .toEqual(['DFII5', 'DFII7', 'DFII10', 'DFII20', 'DFII30', 'DFEDTARU', 'DFEDTARL', 'EFFR'])
    expect(FRED_MACRO_SERIES.find((row) => row.key === 'DXY_PROXY')?.providerSeriesId).toBe('DTWEXBGS')
  })

  it('locks Treasury endpoint paths, fields, and filters', () => {
    const tga = TREASURY_MACRO_ENDPOINTS.find((row) => row.key === 'US_TGA_BALANCE')
    expect(tga?.path).toBe('v1/accounting/od/operating_cash_balance')
    expect(tga?.fields).toContain('close_today_bal')
    expect(tga?.filters).toContain('account_type:eq:Treasury General Account')

    const deposits = TREASURY_MACRO_ENDPOINTS.find((row) => row.key === 'US_TGA_DEPOSITS')
    expect(deposits?.filters).toContain('transaction_type:eq:Deposits')
  })

  it('exposes cadence-aware freshness windows per macro source', () => {
    for (const sourceId of MACRO_SOURCE_IDS) {
      const config = macroAdapterConfigForSource(sourceId)
      expect(config.freshnessWindowMs).toBeGreaterThan(0)
      expect(config.releaseCadence).toBeTruthy()
      expect(config.requestMode).toBeTruthy()
    }

    expect(macroAdapterConfigForSource('bls-economic-series').freshnessWindowMs).toBeGreaterThan(
      macroAdapterConfigForSource('fred-rates-liquidity').freshnessWindowMs
    )
  })
})
