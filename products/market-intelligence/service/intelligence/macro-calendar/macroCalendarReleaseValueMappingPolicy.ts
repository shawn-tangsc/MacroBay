export type MacroCalendarReleaseValueMapping = {
  event: string
  eventKeyPrefix: string
  eventFamily: 'cpi' | 'core-cpi' | 'employment-situation' | 'pce' | 'core-pce' | 'gdp'
  label: string
  unit: string
  adjustment: string
  releaseLabel: string
  /**
   * 这张官方发布在标准表里的**指标码**。写标准表时用它当身份，官方与市场同身份就能合成一行。
   *
   * 这一列**不是手工拍的**：`metricKeyForReleaseValue()` 由 `unit` + `adjustment` 机械推出，
   * 用例逐行比对（`unit`/`adjustment` 与码的测度段/口径段不符 → 红），防止「码写 YOY、
   * 单位写 monthly」这种照抄错。
   */
  metricKey: string
}

/**
 * `unit` + `adjustment` → 码尾。口径段：`NSA` 不调、`SA` 季调；测度段：年率 `YOY`、
 * 月率 `MOM`、年化季率 `ANNUALIZED_QOQ`、水平量 `CHANGE`（人数）/ `RATE`（比率）。
 */
export function metricKeySuffixFor(input: Readonly<{ unit: string; adjustment: string }>): string | undefined {
  const adjusted = input.adjustment === 'seasonally adjusted' ? 'SA'
    : input.adjustment === 'not seasonally adjusted' ? 'NSA' : undefined
  if (adjusted === undefined) return undefined
  if (input.unit === '12-month percent change') return `.${adjusted}.YOY`
  if (input.unit === 'monthly percent change') return `.${adjusted}.MOM`
  if (input.unit === 'annualized percent change') return `.${adjusted}.ANNUALIZED_QOQ`
  if (input.unit === 'thousands') return `.${adjusted}.CHANGE`
  if (input.unit === 'percent') return `.${adjusted}.RATE`
  return undefined
}

export const macroCalendarReleaseValueMappings: readonly MacroCalendarReleaseValueMapping[] = [
  { event: 'cpi', eventKeyPrefix: 'US.CPI', eventFamily: 'cpi', label: 'All items', unit: '12-month percent change', adjustment: 'not seasonally adjusted', releaseLabel: 'BLS official release', metricKey: 'US.CPI.NSA.YOY' },
  { event: 'core-cpi', eventKeyPrefix: 'US.CORE_CPI', eventFamily: 'core-cpi', label: 'All items less food and energy', unit: '12-month percent change', adjustment: 'not seasonally adjusted', releaseLabel: 'BLS official release', metricKey: 'US.CORE_CPI.NSA.YOY' },
  { event: 'nonfarm-payrolls', eventKeyPrefix: 'US.NONFARM_PAYROLLS', eventFamily: 'employment-situation', label: 'Total nonfarm payroll employment', unit: 'thousands', adjustment: 'seasonally adjusted', releaseLabel: 'BLS official release', metricKey: 'US.NONFARM.SA.CHANGE' },
  { event: 'unemployment', eventKeyPrefix: 'US.UNEMPLOYMENT', eventFamily: 'employment-situation', label: 'Civilian unemployment rate', unit: 'percent', adjustment: 'seasonally adjusted', releaseLabel: 'BLS official release', metricKey: 'US.UNEMPLOYMENT.SA.RATE' },
  { event: 'average-hourly-earnings', eventKeyPrefix: 'US.AVERAGE_HOURLY_EARNINGS', eventFamily: 'employment-situation', label: 'Average hourly earnings of all private nonfarm employees', unit: 'monthly percent change', adjustment: 'seasonally adjusted', releaseLabel: 'BLS official release', metricKey: 'US.AHE.SA.MOM' },
  { event: 'pce', eventKeyPrefix: 'US.PCE', eventFamily: 'pce', label: 'Personal consumption expenditures price index', unit: '12-month percent change', adjustment: 'seasonally adjusted', releaseLabel: 'Personal Income and Outlays', metricKey: 'US.PCE.SA.YOY' },
  { event: 'core-pce', eventKeyPrefix: 'US.CORE_PCE', eventFamily: 'core-pce', label: 'Personal consumption expenditures price index excluding food and energy', unit: '12-month percent change', adjustment: 'seasonally adjusted', releaseLabel: 'Personal Income and Outlays', metricKey: 'US.CORE_PCE.SA.YOY' },
  { event: 'gdp', eventKeyPrefix: 'US.GDP', eventFamily: 'gdp', label: 'Real gross domestic product', unit: 'annualized percent change', adjustment: 'seasonally adjusted', releaseLabel: 'Gross Domestic Product', metricKey: 'US.GDP.SA.ANNUALIZED_QOQ' }
]

export function getMacroCalendarReleaseValueMapping(event: string): MacroCalendarReleaseValueMapping | undefined {
  return macroCalendarReleaseValueMappings.find((mapping) => mapping.event === event)
}
