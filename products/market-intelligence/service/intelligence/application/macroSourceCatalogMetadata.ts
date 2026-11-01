/**
 * Locked provider mappings for P0 macro sources (doc 19 / 23).
 * Parsers and request builders must consume these definitions — do not duplicate ids elsewhere.
 */

export const MACRO_SOURCE_IDS = [
  'bls-economic-series',
  'bea-economic-series',
  'fred-rates-liquidity',
  'treasury-fiscal-data'
] as const

export type MacroSourceId = (typeof MACRO_SOURCE_IDS)[number]

export type MacroMetricKind =
  | 'inflation'
  | 'employment'
  | 'growth'
  | 'liquidity'
  | 'treasury-yield'
  | 'dollar'
  | 'rate'

export type MacroComparisonBasis =
  | 'actual-vs-forecast'
  | 'actual-vs-previous'
  | 'period-change'
  | 'level'

export type MacroSeriesDefinition = {
  key: string
  metricName: string
  metricKind: MacroMetricKind
  comparisonBasis: MacroComparisonBasis
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly'
  unit?: string
  providerSeriesId?: string
  dataset?: string
  table?: string
  lineCode?: string
}

export type MacroTreasuryEndpointDefinition = {
  key: string
  metricName: string
  metricKind: MacroMetricKind
  comparisonBasis: MacroComparisonBasis
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly'
  unit?: string
  path: string
  fields: string[]
  filters: string[]
  sort: string
  pageSize: number
  valueField: string
}

export type MacroRequestMode = 'bls-series' | 'bea-dataset' | 'fred-series' | 'treasury-filtered'

export type MacroSourceAdapterConfig = {
  endpointUrl: string
  requestMode: MacroRequestMode
  freshnessWindowMs: number
  releaseCadence: 'daily' | 'weekly' | 'monthly' | 'quarterly'
  series?: MacroSeriesDefinition[]
  treasuryEndpoints?: MacroTreasuryEndpointDefinition[]
  requestDefaults?: Record<string, string | number | boolean>
}

export function isMacroSourceId(sourceId: string): sourceId is MacroSourceId {
  return (MACRO_SOURCE_IDS as readonly string[]).includes(sourceId)
}

/** BLS Public Data API v2 — seasonally adjusted CPI / labor series (doc 19). */
export const BLS_MACRO_SERIES: MacroSeriesDefinition[] = [
  {
    key: 'US_CPI_HEADLINE_YOY',
    providerSeriesId: 'CUSR0000SA0',
    metricName: 'US CPI Headline YoY',
    metricKind: 'inflation',
    comparisonBasis: 'actual-vs-previous',
    frequency: 'monthly',
    unit: 'percent'
  },
  {
    key: 'US_CPI_CORE_YOY',
    providerSeriesId: 'CUSR0000SA0L1E',
    metricName: 'US CPI Core YoY',
    metricKind: 'inflation',
    comparisonBasis: 'actual-vs-previous',
    frequency: 'monthly',
    unit: 'percent'
  },
  {
    key: 'US_PAYROLLS_NFP',
    providerSeriesId: 'CES0000000001',
    metricName: 'US Nonfarm Payrolls Change',
    metricKind: 'employment',
    comparisonBasis: 'period-change',
    frequency: 'monthly',
    unit: 'thousands'
  },
  {
    key: 'US_UNEMPLOYMENT_RATE',
    providerSeriesId: 'LNS14000000',
    metricName: 'US Unemployment Rate',
    metricKind: 'employment',
    comparisonBasis: 'actual-vs-previous',
    frequency: 'monthly',
    unit: 'percent'
  }
]

/** BEA NIPA dataset/table/line mappings (doc 19 / BEA API TableName conventions). */
export const BEA_MACRO_SERIES: MacroSeriesDefinition[] = [
  {
    key: 'US_GDP_REAL_QOQ_ANNUALIZED',
    dataset: 'NIPA',
    table: 'T10101',
    lineCode: '1',
    metricName: 'US Real GDP QoQ Annualized',
    metricKind: 'growth',
    comparisonBasis: 'actual-vs-previous',
    frequency: 'quarterly',
    unit: 'percent'
  },
  {
    key: 'US_PCE_HEADLINE_YOY',
    dataset: 'NIPA',
    table: 'T20304',
    lineCode: '1',
    metricName: 'US PCE Headline YoY',
    metricKind: 'inflation',
    comparisonBasis: 'actual-vs-previous',
    frequency: 'monthly',
    unit: 'percent'
  },
  {
    key: 'US_PCE_CORE_YOY',
    dataset: 'NIPA',
    table: 'T20304',
    lineCode: '25',
    metricName: 'US PCE Core YoY',
    metricKind: 'inflation',
    comparisonBasis: 'actual-vs-previous',
    frequency: 'monthly',
    unit: 'percent'
  }
]

/**
 * FRED series/observations — canonical rates & liquidity (doc 19).
 *
 * The policy block reads the target range and the effective rate from here rather than scraping
 * them out of statement text: the range is a level, so it needs a time series and an as-of date,
 * and the statement only ever states it as prose.
 */
export const FRED_MACRO_SERIES: MacroSeriesDefinition[] = [
  {
    key: 'US_2Y_YIELD',
    providerSeriesId: 'DGS2',
    metricName: 'US 2Y Treasury Yield',
    metricKind: 'treasury-yield',
    comparisonBasis: 'period-change',
    frequency: 'daily',
    unit: 'percent'
  },
  {
    key: 'US_10Y_YIELD',
    providerSeriesId: 'DGS10',
    metricName: 'US 10Y Treasury Yield',
    metricKind: 'treasury-yield',
    comparisonBasis: 'period-change',
    frequency: 'daily',
    unit: 'percent'
  },
  {
    key: 'US_REAL_YIELD_10Y',
    providerSeriesId: 'DFII10',
    metricName: 'US 10Y Real Yield',
    metricKind: 'rate',
    comparisonBasis: 'period-change',
    frequency: 'daily',
    unit: 'percent'
  },
  {
    // The 10-year breakeven the inflation-expectation reading needs. FRED publishes a `.` sentinel
    // for days the TIPS market is closed, which the parser skips rather than reading as 0%.
    key: 'US_10Y_BREAKEVEN_INFLATION',
    providerSeriesId: 'T10YIE',
    metricName: 'US 10Y Breakeven Inflation',
    metricKind: 'inflation',
    comparisonBasis: 'period-change',
    frequency: 'daily',
    unit: 'percent'
  },
  {
    key: 'DXY_PROXY',
    providerSeriesId: 'DTWEXBGS',
    metricName: 'US Dollar Index (Broad) Proxy',
    metricKind: 'dollar',
    comparisonBasis: 'period-change',
    frequency: 'daily',
    unit: 'index'
  },
  {
    key: 'FED_BALANCE_SHEET',
    providerSeriesId: 'WALCL',
    metricName: 'Fed Balance Sheet Total Assets',
    metricKind: 'liquidity',
    comparisonBasis: 'period-change',
    frequency: 'weekly',
    unit: 'millions-usd'
  },
  {
    key: 'FED_TARGET_RANGE_UPPER',
    providerSeriesId: 'DFEDTARU',
    metricName: 'Fed Funds Target Range Upper',
    metricKind: 'rate',
    comparisonBasis: 'level',
    frequency: 'daily',
    unit: 'percent'
  },
  {
    key: 'FED_TARGET_RANGE_LOWER',
    providerSeriesId: 'DFEDTARL',
    metricName: 'Fed Funds Target Range Lower',
    metricKind: 'rate',
    comparisonBasis: 'level',
    frequency: 'daily',
    unit: 'percent'
  },
  {
    key: 'FED_EFFECTIVE_FUNDS_RATE',
    providerSeriesId: 'EFFR',
    metricName: 'Effective Federal Funds Rate',
    metricKind: 'rate',
    comparisonBasis: 'period-change',
    frequency: 'daily',
    unit: 'percent'
  }
]

/** Treasury Fiscal Data filtered endpoints (doc 19). */
export const TREASURY_MACRO_ENDPOINTS: MacroTreasuryEndpointDefinition[] = [
  {
    key: 'US_TGA_BALANCE',
    metricName: 'Treasury General Account Balance',
    metricKind: 'liquidity',
    comparisonBasis: 'period-change',
    frequency: 'daily',
    unit: 'millions-usd',
    path: 'v1/accounting/od/operating_cash_balance',
    fields: ['record_date', 'account_type', 'close_today_bal'],
    filters: ['account_type:eq:Treasury General Account'],
    sort: '-record_date',
    pageSize: 10,
    valueField: 'close_today_bal'
  },
  {
    key: 'US_TGA_DEPOSITS',
    metricName: 'Treasury General Account Deposits',
    metricKind: 'liquidity',
    comparisonBasis: 'period-change',
    frequency: 'daily',
    unit: 'millions-usd',
    path: 'v1/accounting/od/deposits_withdrawals_operating_cash',
    fields: ['record_date', 'account_type', 'transaction_type', 'transaction_today_amt'],
    filters: ['account_type:eq:Treasury General Account', 'transaction_type:eq:Deposits'],
    sort: '-record_date',
    pageSize: 20,
    valueField: 'transaction_today_amt'
  },
  {
    key: 'US_TGA_WITHDRAWALS',
    metricName: 'Treasury General Account Withdrawals',
    metricKind: 'liquidity',
    comparisonBasis: 'period-change',
    frequency: 'daily',
    unit: 'millions-usd',
    path: 'v1/accounting/od/deposits_withdrawals_operating_cash',
    fields: ['record_date', 'account_type', 'transaction_type', 'transaction_today_amt'],
    filters: ['account_type:eq:Treasury General Account', 'transaction_type:eq:Withdrawals'],
    sort: '-record_date',
    pageSize: 20,
    valueField: 'transaction_today_amt'
  }
]

const MS_PER_DAY = 24 * 60 * 60 * 1000

export const BLS_MACRO_ADAPTER_CONFIG: MacroSourceAdapterConfig = {
  endpointUrl: 'https://api.bls.gov/publicAPI/v2/timeseries/data/',
  requestMode: 'bls-series',
  releaseCadence: 'monthly',
  freshnessWindowMs: 45 * MS_PER_DAY,
  series: BLS_MACRO_SERIES,
  requestDefaults: {
    startyear: '2018',
    endyear: '2026',
    latest: true
  }
}

export const BEA_MACRO_ADAPTER_CONFIG: MacroSourceAdapterConfig = {
  endpointUrl: 'https://apps.bea.gov/api/data',
  requestMode: 'bea-dataset',
  releaseCadence: 'monthly',
  freshnessWindowMs: 45 * MS_PER_DAY,
  series: BEA_MACRO_SERIES,
  requestDefaults: {
    method: 'GetData',
    Year: 'ALL'
  }
}

export const FRED_MACRO_ADAPTER_CONFIG: MacroSourceAdapterConfig = {
  endpointUrl: 'https://api.stlouisfed.org/fred/series/observations',
  requestMode: 'fred-series',
  releaseCadence: 'daily',
  freshnessWindowMs: 7 * MS_PER_DAY,
  series: FRED_MACRO_SERIES,
  requestDefaults: {
    file_type: 'json',
    sort_order: 'desc',
    limit: 5
  }
}

export const TREASURY_MACRO_ADAPTER_CONFIG: MacroSourceAdapterConfig = {
  endpointUrl: 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/',
  requestMode: 'treasury-filtered',
  releaseCadence: 'daily',
  freshnessWindowMs: 7 * MS_PER_DAY,
  treasuryEndpoints: TREASURY_MACRO_ENDPOINTS
}

export function macroAdapterConfigForSource(sourceId: MacroSourceId): MacroSourceAdapterConfig {
  switch (sourceId) {
    case 'bls-economic-series':
      return BLS_MACRO_ADAPTER_CONFIG
    case 'bea-economic-series':
      return BEA_MACRO_ADAPTER_CONFIG
    case 'fred-rates-liquidity':
      return FRED_MACRO_ADAPTER_CONFIG
    case 'treasury-fiscal-data':
      return TREASURY_MACRO_ADAPTER_CONFIG
    default:
      throw new Error(`Unknown macro source: ${sourceId}`)
  }
}
