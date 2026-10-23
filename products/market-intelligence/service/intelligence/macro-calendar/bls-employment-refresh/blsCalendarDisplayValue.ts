import type { MacroCalendarValue } from '../macroCalendarContracts'

export const BlsCalendarDisplayValuePolicy = Object.freeze({
  percentMetrics: Object.freeze(['cpi', 'core-cpi', 'unemployment', 'average-hourly-earnings']),
  payrollMetric: 'nonfarm-payrolls',
  units: Object.freeze({ percent: 'percent', payroll: 'thousands' }),
  percentFormat: Object.freeze({
    locale: 'en-US',
    useGrouping: false,
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    roundingMode: 'halfExpand'
  })
} as const)

export type BlsCalendarMetric =
  | (typeof BlsCalendarDisplayValuePolicy.percentMetrics)[number]
  | typeof BlsCalendarDisplayValuePolicy.payrollMetric

type HalfExpandNumberFormatOptions = Intl.NumberFormatOptions & { roundingMode: 'halfExpand' }

const percentFormatOptions: HalfExpandNumberFormatOptions = {
  useGrouping: BlsCalendarDisplayValuePolicy.percentFormat.useGrouping,
  minimumFractionDigits: BlsCalendarDisplayValuePolicy.percentFormat.minimumFractionDigits,
  maximumFractionDigits: BlsCalendarDisplayValuePolicy.percentFormat.maximumFractionDigits,
  roundingMode: BlsCalendarDisplayValuePolicy.percentFormat.roundingMode
}

const percentFormatter = new Intl.NumberFormat(BlsCalendarDisplayValuePolicy.percentFormat.locale, percentFormatOptions)

export function formatBlsCalendarValue(
  metric: string,
  numericValue: number,
  storedUnit?: string
): MacroCalendarValue | undefined {
  if (!Number.isFinite(numericValue)) return undefined
  if ((BlsCalendarDisplayValuePolicy.percentMetrics as readonly string[]).includes(metric)) {
    if (storedUnit !== undefined && storedUnit !== BlsCalendarDisplayValuePolicy.units.percent) return undefined
    const normalized = Object.is(numericValue, -0) ? 0 : numericValue
    return { numericValue, displayValue: `${percentFormatter.format(normalized)}%`, unit: BlsCalendarDisplayValuePolicy.units.percent }
  }
  if (metric !== BlsCalendarDisplayValuePolicy.payrollMetric || !Number.isSafeInteger(numericValue) ||
    (storedUnit !== undefined && storedUnit !== BlsCalendarDisplayValuePolicy.units.payroll)) return undefined
  const sign = numericValue > 0 ? '+' : ''
  return { numericValue, displayValue: `${sign}${numericValue}K`, unit: BlsCalendarDisplayValuePolicy.units.payroll }
}
