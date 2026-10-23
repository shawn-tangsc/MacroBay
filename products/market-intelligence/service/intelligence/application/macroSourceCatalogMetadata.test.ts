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
    expect(ids).toEqual(['DGS2', 'DGS10', 'DFII10', 'T10YIE', 'DTWEXBGS', 'WALCL'])
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
