import type { AgentEvidenceRef, AgentFact } from '../../../contracts/marketAnalysisContracts'
import { MARKET_ANALYSIS_RUN_SOURCE_BUDGET } from '../analysis/analysisRunPolicy'
import { marketCalendarObservationPolicy, readMarketCalendarObservations } from '../macro-calendar/marketCalendarObservationNormalization'
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
  const reads = new Map<string, Promise<Readonly<{
    state: 'available' | 'unavailable'
    facts: readonly AgentFact[]
    evidenceRefs: readonly string[]
  }>>>()
  const readMonth = (query: MacroCalendarEventContextQuery) => {
    const key = `${query.month}:${query.asOf}`
    const cached = reads.get(key)
    if (cached) return cached
    const pending = (async () => {
      const facts: AgentFact[] = []
      const evidenceRefs = new Map<string, AgentEvidenceRef>()
      const caveats = new Set<string>()
      const observations: Parameters<typeof projectMacroCalendar>[5] = {}
      let officialRead = false
      let providerRead = false
      const official = service.queryMacroEconomicCalendarMonth
        ? await (async () => {
            // The product's own query is synchronous and untyped at the boundary; awaiting is safe either way.
            try {
              const page = await service.queryMacroEconomicCalendarMonth!({ month: query.month, asOf: query.asOf, maxEvents: MARKET_ANALYSIS_RUN_SOURCE_BUDGET.macroCalendarMaximumEvents })
              if (page && page.state === 'available') officialRead = true
              return page
            } catch { return undefined }
          })()
        : undefined
      const provider = service.queryMarketCalendarMonth
        ? (() => {
            try {
              const set = readMarketCalendarObservations(service.queryMarketCalendarMonth!, { month: query.month, asOf: query.asOf })
              // 这一层把「页面读不到」折成一条 caveat，和「这个月没有事件」共用空数组；只能从那条
              // caveat 认出它没读成，不然后面就会把读失败说成空。
              providerRead = !(set.observations.length === 0 && set.caveats.includes(marketCalendarObservationPolicy.caveats.pageUnavailable))
              return set
            } catch { return undefined }
          })()
        : undefined
      projectMacroCalendar({ official, provider }, query.asOf, facts, evidenceRefs, caveats, observations)
      // 两侧一次都没读成才算读不到：一侧读成时，事件仍可能落在那一侧。
      const state = officialRead || providerRead ? 'available' as const : 'unavailable' as const
      return { state, facts, evidenceRefs: [...evidenceRefs.keys()] }
    })()
    reads.set(key, pending)
    return pending
  }
  return {
    readFacts: async query => (await readMonth(query)).facts,
    readEvidenceRefs: async query => (await readMonth(query)).evidenceRefs,
    readState: async query => (await readMonth(query)).state,
    isVisible: isVisibleAsOf
  }
}
