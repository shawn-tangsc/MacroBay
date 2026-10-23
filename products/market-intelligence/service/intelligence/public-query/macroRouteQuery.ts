import type { MarketCalendarPage } from '../../../contracts/macro/marketCalendarQueryContracts'
import type { MacroCalendarProviderObservationSet } from '../macro-calendar/marketCalendarObservationNormalization'
import { readMarketCalendarObservations } from '../macro-calendar/marketCalendarObservationNormalization'
import type { MacroEconomicCalendarMonthResult } from '../macro-calendar/macroEconomicCalendarQueryService'
import { MARKET_ANALYSIS_MACRO_CALENDAR_POLICY } from '../../../contracts/marketAnalysisContracts'

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

export type MacroRoute = Readonly<{
  official: readonly MacroEconomicCalendarEventView[]
  provider: readonly MacroCalendarProviderObservation[]
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
  for (const month of input.months.slice(0, macroRouteQueryPolicy.maximumMonths)) {
    if (queries.queryMacroEconomicCalendarMonth) {
      try {
        const page = await queries.queryMacroEconomicCalendarMonth({ month, asOf: input.asOf, maxEvents: MARKET_ANALYSIS_MACRO_CALENDAR_POLICY.maxEvents })
        if (page.state === 'available') official.push(...page.events)
      } catch { /* a month that cannot be read contributes nothing, never an exception */ }
    }
    if (queries.queryMarketCalendarMonth) {
      try {
        provider.push(...readMarketCalendarObservations(queries.queryMarketCalendarMonth, { month, asOf: input.asOf }).observations)
      } catch { /* same: partial ranges stay comparable */ }
    }
  }
  return { official, provider, months: [...input.months], asOf: input.asOf }
}
