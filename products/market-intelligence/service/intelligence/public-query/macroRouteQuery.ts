import type { MarketCalendarPage } from '../../../contracts/macro/marketCalendarQueryContracts'
import type { MacroCalendarProviderObservationSet } from '../macro-calendar/marketCalendarObservationNormalization'
import { readMarketCalendarObservations } from '../macro-calendar/marketCalendarObservationNormalization'
import type { MacroEconomicCalendarMonthResult } from '../macro-calendar/macroEconomicCalendarQueryService'
import { MARKET_ANALYSIS_RUN_SOURCE_BUDGET } from '../analysis/analysisRunPolicy'

/**
 * One place that reads the raw macro route.
 *
 * The significance gate and the evidence-context build must look at the same data, otherwise
 * the gate can approve a run for a change the model never sees, or stay silent about a change
 * the model is shown. Both now come through here.
 *
 * "Raw" means no admission and no truncation: `readMarketCalendarObservations` still applies
 * its own relevance ranking and 20-observation cap internally, and that is a known, documented
 * limit of the route rather than of this function. The context build applies the additional
 * 160-fact budget on top when it projects facts.
 *
 * Failure is per month and per route: a month that cannot be read yields an empty list for
 * that route so a partially readable range still produces a comparable baseline.
 */

export type MacroRouteQuery = Readonly<{
  queryMacroEconomicCalendarMonth?: (input: { month: string; asOf: string; maxEvents?: number }) => Promise<MacroEconomicCalendarMonthResult>
  queryMarketCalendarMonth?: (input: unknown) => MarketCalendarPage
}>

/**
 * 一侧日历「读没读到」，和它读了什么分开。
 *
 * 空数组有两种意思：这个月确实没有事件，或者根本读不到。合并成一个数组，读侧就只能把
 * 「读不到」画成「没有」——这两个状态必须分开表达，调用方判 `state`，不判 `facts.length`。
 */
export type CalendarReadState = 'available' | 'unavailable'
export type CalendarReadReasonCode = 'query-failed' | 'field-missing' | 'timeout' | 'not-wired'
export type CalendarRead<T> = Readonly<{
  state: CalendarReadState
  reasonCode?: CalendarReadReasonCode
  facts: readonly T[]
}>

export type MacroRoute = Readonly<{
  official: CalendarRead<MacroEconomicCalendarEventView>
  provider: CalendarRead<MacroCalendarProviderObservation>
  months: readonly string[]
  asOf: string
}>

type MacroEconomicCalendarEventView = Extract<MacroEconomicCalendarMonthResult, { state: 'available' }>['events'][number]
type MacroCalendarProviderObservation = MacroCalendarProviderObservationSet['observations'][number]

export const macroRouteQueryPolicy = Object.freeze({
  version: 'marketAnalysisMacroRouteQueryPolicy.v1',
  maximumMonths: 2
})

export function normalizeMacroRouteMonths(asOf: string, previousAsOf: string | null): readonly string[] {
  const months = [asOf.slice(0, 7)]
  if (previousAsOf) months.push(previousAsOf.slice(0, 7))
  return [...new Set(months)].slice(0, macroRouteQueryPolicy.maximumMonths)
}

export async function queryMacroRoute(queries: MacroRouteQuery, input: Readonly<{ asOf: string; months: readonly string[] }>): Promise<MacroRoute> {
  const official: MacroEconomicCalendarEventView[] = []
  const provider: MacroCalendarProviderObservation[] = []
  const officialMonths = { attempted: 0, read: 0 }
  const providerMonths = { attempted: 0, read: 0 }
  for (const month of input.months.slice(0, macroRouteQueryPolicy.maximumMonths)) {
    if (queries.queryMacroEconomicCalendarMonth) {
      officialMonths.attempted += 1
      try {
        const page = await queries.queryMacroEconomicCalendarMonth({ month, asOf: input.asOf, maxEvents: MARKET_ANALYSIS_RUN_SOURCE_BUDGET.macroCalendarMaximumEvents })
        if (page.state === 'available') { official.push(...page.events); officialMonths.read += 1 }
      } catch { /* a month that cannot be read contributes nothing, never an exception */ }
    }
    if (queries.queryMarketCalendarMonth) {
      providerMonths.attempted += 1
      try {
        provider.push(...readMarketCalendarObservations(queries.queryMarketCalendarMonth, { month, asOf: input.asOf }).observations)
        providerMonths.read += 1
      } catch { /* same: partial ranges stay comparable */ }
    }
  }
  // 部分可读仍是「可读」：一个月失败不该把另一个月读到的数据说成读不到。只有「一次都没读成」
  // 或「根本没接」才是 `unavailable`——那才是调用方必须当成「不知道」而不是「没有」的情况。
  return {
    official: readOf(official, officialMonths, queries.queryMacroEconomicCalendarMonth !== undefined),
    provider: readOf(provider, providerMonths, queries.queryMarketCalendarMonth !== undefined),
    months: [...input.months], asOf: input.asOf
  }
}

function readOf<T>(facts: readonly T[], months: Readonly<{ attempted: number; read: number }>, wired: boolean): CalendarRead<T> {
  if (!wired) return Object.freeze({ state: 'unavailable', reasonCode: 'not-wired', facts: Object.freeze([...facts]) })
  if (months.attempted > 0 && months.read === 0) return Object.freeze({ state: 'unavailable', reasonCode: 'query-failed', facts: Object.freeze([...facts]) })
  return Object.freeze({ state: 'available', facts: Object.freeze([...facts]) })
}
