import { randomUUID } from 'node:crypto'
import type { MacroEconomicCalendarMonthResult } from './macroEconomicCalendarQueryService'
import type { MacroEconomicCalendarEventView } from '../../../contracts/macro/economicCalendarQueryContracts'
import { isMarketCalendarEvent, isMarketCalendarPage, isMarketCalendarQuery, marketCalendarPublicPolicy,
  type MarketCalendarEvent, type MarketCalendarOfficialLink, type MarketCalendarPage, type MarketCalendarQuery,
  type MarketCalendarSource } from '../../../contracts/macro/marketCalendarQueryContracts'

// Design 122: three bounded batches, ephemeral pagination; no archive/history reads.
export const MacroCalendarLinkedQueryPolicy = Object.freeze({ maximumEvents: 3000, maximumPages: 3000,
  maximumContexts: 16, contextLifetimeMs: 60_000 })
type SafeOfficialQuery = { queryMonth: (input: { month: string; asOf: string }) => MacroEconomicCalendarMonthResult }
export type SafeMarketQuery = { queryMonth: (input: MarketCalendarQuery, observe?: (event: MarketCalendarEvent, evidence: { providerId: string; descriptorId: string; locale: string; evidenceHash: string; sourceEventId: string; indicatorId: string | null }) => void) => unknown }
type Context = { query: Omit<MarketCalendarQuery, 'cursor'>; events: readonly MarketCalendarEvent[];
  sources: readonly MarketCalendarSource[]; offset: number; createdAt: number }

/** Main-only composition. No partial page is linked before the selected batches finish. */
export function createMacroCalendarLinkedQueryService(deps: {
  official: SafeOfficialQuery; market: SafeMarketQuery; now?: () => number
  link?: (official: MacroEconomicCalendarEventView, market: MarketCalendarEvent, evidence?: unknown) => MarketCalendarOfficialLink | undefined
}) {
  const contexts = new Map<string, Context>()
  const now = deps.now ?? Date.now
  const policy = MacroCalendarLinkedQueryPolicy
  const unavailable = (): MarketCalendarPage => ({ state: 'unavailable', failureCode: 'query-unavailable' })
  function deliver(context: Context): MarketCalendarPage {
    let offset = context.offset
    const events: MarketCalendarEvent[] = []
    const base = { state: 'available' as const, ...context.query, sources: context.sources }
    const cursor = randomUUID()
    while (offset < context.events.length && events.length < marketCalendarPublicPolicy.maximumEvents) {
      const next = context.events[offset]!
      if (Buffer.byteLength(JSON.stringify({ ...base, events: [...events, next], nextCursor: cursor })) > marketCalendarPublicPolicy.pageBytes) break
      events.push(next); offset++
    }
    if (offset < context.events.length) {
      if (!events.length) return unavailable()
      while (contexts.size >= policy.maximumContexts) contexts.delete(contexts.keys().next().value!)
      contexts.set(cursor, { ...context, offset })
    }
    const result = { ...base, events, ...(offset < context.events.length ? { nextCursor: cursor } : {}) }
    return isMarketCalendarPage(result, context.query) ? result : unavailable()
  }
  return Object.freeze({
    async queryMonth(input: unknown): Promise<MarketCalendarPage> {
      if (!isMarketCalendarQuery(input)) return { state: 'unavailable', failureCode: 'input-invalid' }
      try {
        const { month, locale, asOf } = input
        const query = { month, locale, asOf }
        for (const [key, context] of contexts) if (now() - context.createdAt >= policy.contextLifetimeMs) contexts.delete(key)
        if (input.cursor) {
          const context = contexts.get(input.cursor)
          if (!context || JSON.stringify(context.query) !== JSON.stringify(query)) return unavailable()
          return deliver(context)
        }
        let official: MacroEconomicCalendarMonthResult
        try { official = deps.official.queryMonth({ month, asOf }) }
        catch { official = { state: 'unavailable', failureCode: 'calendar-query-unavailable' } }
        const events: MarketCalendarEvent[] = []
        const evidenceByEvent = new Map<string, unknown>()
        let sources: readonly MarketCalendarSource[] | undefined
        const seenCursors = new Set<string>(), seenEvents = new Set<string>()
        let cursor: string | undefined
        let pages = 0
        do {
          const request = { ...query, ...(cursor ? { cursor } : {}) }
          const page = await deps.market.queryMonth(request, (event, evidence) => evidenceByEvent.set(event.eventKey, evidence))
          if (!isMarketCalendarPage(page, request) || page.state !== 'available') return unavailable()
          if (sources && JSON.stringify(sources) !== JSON.stringify(page.sources)) return unavailable()
          sources = page.sources
          if (++pages > policy.maximumPages || events.length + page.events.length > policy.maximumEvents) return unavailable()
          for (const event of page.events) {
            if (seenEvents.has(event.eventKey)) return unavailable()
            seenEvents.add(event.eventKey)
            const { officialLink: _ignored, ...independent } = event
            events.push(independent)
          }
          cursor = page.nextCursor
          if (cursor && seenCursors.has(cursor)) return unavailable()
          if (cursor) seenCursors.add(cursor)
        } while (cursor)
        const candidates = official.state === 'available' && official.asOf === asOf && deps.link
          ? events.map(event => official.events.flatMap(item => {
            const link = deps.link!(item, event, evidenceByEvent.get(event.eventKey))
            return link && link.officialEventKey === item.eventKey && link.officialDetectedAt === item.detectedAt &&
              item.detectedAt <= asOf && isMarketCalendarEvent({ ...event, officialLink: link }) ? [link] : []
          })) : events.map((): MarketCalendarOfficialLink[] => [])
        const projected = events.map((event, index) => {
          const matches = candidates[index]!
          const link = matches.length === 1 ? matches[0] : undefined
          const unique = link && candidates.filter(items => items.some(item => item.officialEventKey === link.officialEventKey)).length === 1
          return unique ? { ...event, officialLink: link } : event
        })
        return deliver({ query, events: projected, sources: sources!, offset: 0, createdAt: now() })
      } catch { return unavailable() }
    }
  })
}
