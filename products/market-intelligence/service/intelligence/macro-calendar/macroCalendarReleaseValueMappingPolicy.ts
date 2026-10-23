export type MacroCalendarReleaseValueMapping = {
  event: string
  eventKeyPrefix: string
  eventFamily: 'cpi' | 'core-cpi' | 'employment-situation' | 'pce' | 'core-pce' | 'gdp'
  label: string
  unit: string
  adjustment: string
  releaseLabel: string
}

export const macroCalendarReleaseValueMappings: readonly MacroCalendarReleaseValueMapping[] = [
  { event: 'cpi', eventKeyPrefix: 'US.CPI', eventFamily: 'cpi', label: 'All items', unit: '12-month percent change', adjustment: 'not seasonally adjusted', releaseLabel: 'BLS official release' },
  { event: 'core-cpi', eventKeyPrefix: 'US.CORE_CPI', eventFamily: 'core-cpi', label: 'All items less food and energy', unit: '12-month percent change', adjustment: 'not seasonally adjusted', releaseLabel: 'BLS official release' },
  { event: 'nonfarm-payrolls', eventKeyPrefix: 'US.NONFARM_PAYROLLS', eventFamily: 'employment-situation', label: 'Total nonfarm payroll employment', unit: 'thousands', adjustment: 'seasonally adjusted', releaseLabel: 'BLS official release' },
  { event: 'unemployment', eventKeyPrefix: 'US.UNEMPLOYMENT', eventFamily: 'employment-situation', label: 'Civilian unemployment rate', unit: 'percent', adjustment: 'seasonally adjusted', releaseLabel: 'BLS official release' },
  { event: 'average-hourly-earnings', eventKeyPrefix: 'US.AVERAGE_HOURLY_EARNINGS', eventFamily: 'employment-situation', label: 'Average hourly earnings of all private nonfarm employees', unit: 'monthly percent change', adjustment: 'seasonally adjusted', releaseLabel: 'BLS official release' },
  { event: 'pce', eventKeyPrefix: 'US.PCE', eventFamily: 'pce', label: 'Personal consumption expenditures price index', unit: '12-month percent change', adjustment: 'not seasonally adjusted', releaseLabel: 'Personal Income and Outlays' },
  { event: 'core-pce', eventKeyPrefix: 'US.CORE_PCE', eventFamily: 'core-pce', label: 'Personal consumption expenditures price index excluding food and energy', unit: '12-month percent change', adjustment: 'not seasonally adjusted', releaseLabel: 'Personal Income and Outlays' },
  { event: 'gdp', eventKeyPrefix: 'US.GDP', eventFamily: 'gdp', label: 'Real gross domestic product', unit: 'annualized percent change', adjustment: 'seasonally adjusted', releaseLabel: 'Gross Domestic Product' }
]

export function getMacroCalendarReleaseValueMapping(event: string): MacroCalendarReleaseValueMapping | undefined {
  return macroCalendarReleaseValueMappings.find((mapping) => mapping.event === event)
}
