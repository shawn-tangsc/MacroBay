import type { AgentEvidenceRef, AgentFact } from '../../../contracts/marketAnalysisContracts'
import { MARKET_ANALYSIS_MACRO_CALENDAR_POLICY } from '../../../contracts/marketAnalysisContracts'
import { readMarketCalendarObservations } from '../macro-calendar/marketCalendarObservationNormalization'
import { isVisibleAsOf } from './asOfVisibility'
import { projectMacroCalendar } from './marketAnalysisContextProjection'
import type { MacroCalendarEventContextReads } from './macroCalendarEventContextAdapter'
import type { MacroCalendarEventContextQuery } from './macroCalendarEventContextQuery'

/**
 * The concrete readers for a selected event's context.
 *
 * It reuses the analysis context path's own read of the month — the official query under its
 * max-events policy plus the provider observation read — rather than inventing a second way to
 * look at the calendar, and it reads the *event's* month rather than the `asOf` month, which differ
 * for an event carried over from the previous one.
 *
 * Both ports share one read because the adapter asks for facts and evidence together; without the
 * memo every question would read the month twice more. `projectMacroCalendar` appends into
 * accumulators instead of returning them, so this builds them and hands back what it collected.
 */
/**
 * The two month queries this needs, taken as raw functions rather than as the public query facade:
 * the facade will call this, so depending on the facade's own type would close an import cycle, and
 * naming only what is used keeps the wiring honest about what it reads.
 */
export type MacroCalendarEventContextQuerySources = Readonly<{
  queryMacroEconomicCalendarMonth?: (input: unknown) => Parameters<typeof projectMacroCalendar>[0]['official'] | Promise<Parameters<typeof projectMacroCalendar>[0]['official']>
  queryMarketCalendarMonth?: Parameters<typeof readMarketCalendarObservations>[0]
}>

export function macroCalendarEventContextReaders(service: MacroCalendarEventContextQuerySources): MacroCalendarEventContextReads {
  const reads = new Map<string, Promise<Readonly<{ facts: readonly AgentFact[]; evidenceRefs: readonly string[] }>>>()
  const readMonth = (query: MacroCalendarEventContextQuery) => {
    const key = `${query.month}:${query.asOf}`
    const cached = reads.get(key)
    if (cached) return cached
    const pending = (async () => {
      const facts: AgentFact[] = []
      const evidenceRefs = new Map<string, AgentEvidenceRef>()
      const caveats = new Set<string>()
      const observations: Parameters<typeof projectMacroCalendar>[5] = {}
      const official = service.queryMacroEconomicCalendarMonth
        // The product's own query is synchronous and untyped at the boundary; awaiting is safe either way.
        ? await service.queryMacroEconomicCalendarMonth({ month: query.month, asOf: query.asOf, maxEvents: MARKET_ANALYSIS_MACRO_CALENDAR_POLICY.maxEvents })
        : undefined
      const provider = service.queryMarketCalendarMonth
        ? readMarketCalendarObservations(service.queryMarketCalendarMonth, { month: query.month, asOf: query.asOf })
        : undefined
      projectMacroCalendar({ official, provider }, query.asOf, facts, evidenceRefs, caveats, observations)
      return { facts, evidenceRefs: [...evidenceRefs.keys()] }
    })()
    reads.set(key, pending)
    return pending
  }
  return {
    readFacts: async query => (await readMonth(query)).facts,
    readEvidenceRefs: async query => (await readMonth(query)).evidenceRefs,
    isVisible: isVisibleAsOf
  }
}
