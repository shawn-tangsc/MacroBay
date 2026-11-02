import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingCalendarEvent, DailyBriefingFactPacket } from './dailyBriefingFactPacket'
import type { DailyBriefingSourceDeps } from './dailyBriefingSource'
import type { TimelineItem } from './dailyBriefingFactSnapshot'
import { assessMarketCalendarSurprise, toCalendarSurpriseView } from '../../../contracts/macro/marketCalendarSurprise'
import {
  collectAnalysisPriorConclusions,
  collectBriefingPriorConclusions,
  mergePriorConclusions
} from './dailyBriefingPriorConclusions'
import type { MarketIntelligencePublicQueryService } from '../public-query/publicQueryService'
import type { DailyBriefingStoredEdition } from './dailyBriefingService'
import { DAY_MS, HOUR_MS, safe, safeSync } from './dailyBriefingSafeRead'

/**
 * The localized layer: prior conclusions in the reader's language, and the calendar's titles.
 *
 * Nothing here touches a number, a row order or the cutoff — those arrived frozen in the fact
 * snapshot. This module is the only place a second reading is allowed, and the only reason it is
 * allowed is that its output is text the two editions may legitimately say differently.
 */

export async function readPriorConclusions(
  deps: DailyBriefingSourceDeps,
  timeline: readonly TimelineItem[],
  asOf: string,
  windowStart: string,
  locale: DailyBriefingLocale
): Promise<readonly import('../../../contracts/dailyBriefing').BriefingPriorConclusion[]> {
  const analysis = collectAnalysisPriorConclusions({
    entries: timeline,
    windowStart,
    asOf,
    readSummary: (summaryId) => {
      try {
        return deps.repository.getSummary(summaryId)
      } catch {
        return undefined
      }
    }
  })
  let briefs: readonly DailyBriefingStoredEdition[] = Object.freeze([])
  if (deps.briefEditions) {
    // One day of slack on the left: the store is keyed by the reader's local edition date, which can
    // sit a calendar day before the UTC window start. The windowEnd check below is authoritative.
    const from = new Date(Date.parse(windowStart) - DAY_MS).toISOString().slice(0, 10)
    const to = asOf.slice(0, 10)
    briefs = await safe(() => deps.briefEditions!.list(from, to, locale), Object.freeze([]))
  }
  return mergePriorConclusions([
    analysis,
    collectBriefingPriorConclusions({ editions: briefs, windowStart, asOf })
  ])
}

export async function readCalendar(
  deps: DailyBriefingSourceDeps,
  asOf: string,
  locale: DailyBriefingLocale,
  enabled: boolean,
  windowStart: string
): Promise<DailyBriefingFactPacket['calendar']> {
  if (!enabled) return Object.freeze({ state: 'source-disabled' as const, events: Object.freeze([]) })
  const months = calendarMonths(asOf)
  const events = new Map<string, DailyBriefingCalendarEvent>()
  let available = false
  for (const month of months) {
    const official = await safe(
      () => deps.publicQuery.queryMacroEconomicCalendarMonth({ month, asOf, maxEvents: 100 }),
      undefined
    )
    const market = readMarketCalendar(deps, month, locale, asOf)
    if (official?.state === 'available') {
      available = true
      for (const event of official.events) {
        if (events.has(event.eventKey)) continue
        events.set(event.eventKey, officialEvent(event, asOf))
      }
    }
    if (market?.state === 'available') {
      available = true
      for (const event of market.events) {
        const linked = event.officialLink?.officialEventKey
        if (linked && events.has(linked)) {
          const official = events.get(linked)!
          events.set(linked, Object.freeze({
            ...official,
            ...(official.consensus ? {} : event.consensus ? { consensus: event.consensus.displayValue } : {}),
            ...(official.previous ? {} : event.providerPrevious ? { previous: event.providerPrevious.displayValue } : {}),
            ...(official.countryCode ? {} : event.countryCode ? { countryCode: event.countryCode } : {}),
            ...(official.countryName ? {} : event.countryName ? { countryName: event.countryName } : {})
          }))
          continue
        }
        if (events.has(event.eventKey)) continue
        events.set(event.eventKey, marketEvent(event, asOf))
      }
    }
  }
  // A later collection can omit the actual value even though an earlier collection in the same
  // release batch stored it. Ask again at the latest release instant in the window and merge the
  // actual/previous/consensus fields; no extra month is read.
  const start = Date.parse(windowStart)
  const missing = [...events.values()]
    .filter((event) => event.importance === 'high' && event.actual === undefined)
    .filter((event) => {
      const at = Date.parse(event.scheduledAt)
      return Number.isFinite(at) && at >= start && at < Date.parse(asOf)
    })
    .sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt))
  const latest = missing.at(-1)
  if (latest) {
    const fallbackAsOf = new Date(Date.parse(latest.scheduledAt) + 60 * 60 * 1000).toISOString()
    const refreshed = readMarketCalendar(deps, latest.scheduledAt.slice(0, 7), locale, fallbackAsOf)
    if (refreshed?.state === 'available') {
      for (const event of refreshed.events) {
        const existing = events.get(event.eventKey)
        if (existing && !existing.actual && event.providerActual) events.set(event.eventKey, marketEvent(event, asOf))
      }
    }
  }
  return Object.freeze({
    state: available ? 'available' as const : 'unavailable' as const,
    events: Object.freeze([...events.values()])
  })
}

function readMarketCalendar(
  deps: DailyBriefingSourceDeps,
  month: string,
  locale: DailyBriefingLocale,
  asOf: string
): Extract<ReturnType<MarketIntelligencePublicQueryService['queryMarketCalendarMonth']>, { state: 'available' }> | undefined {
  const localeCode = locale === 'en-US' ? 'en' as const : 'zh' as const
  const first = safeSync(() => deps.publicQuery.queryMarketCalendarMonth({ month, locale: localeCode, asOf }), undefined)
  if (!first || first.state !== 'available') return undefined
  const events = [...first.events]
  let cursor = first.nextCursor
  for (let page = 0; cursor && page < 8; page++) {
    const next = safeSync(() => deps.publicQuery.queryMarketCalendarMonth({ month, locale: localeCode, asOf, cursor }), undefined)
    if (!next || next.state !== 'available') break
    events.push(...next.events)
    cursor = next.nextCursor
  }
  return Object.freeze({ ...first, events: Object.freeze(events), nextCursor: undefined })
}

function officialEvent(
  event: Extract<Awaited<ReturnType<MarketIntelligencePublicQueryService['queryMacroEconomicCalendarMonth']>>, { state: 'available' }>['events'][number],
  _asOf: string
): DailyBriefingCalendarEvent {
  const scheduledAt = event.scheduledAt ?? event.conventionScheduledAt ?? `${event.scheduledDate}T00:00:00.000Z`
  const surprise = assessMarketCalendarSurprise(event.actual, event.consensus)
  return Object.freeze({
    eventKey: event.eventKey,
    title: event.titleKey,
    titleKey: event.titleKey,
    countryCode: event.countryCode,
    scheduledAt,
    importance: event.importance,
    lifecycleState: event.lifecycleState,
    category: 'economic-indicator' as const,
    ...(event.actual ? { actual: event.actual.displayValue } : {}),
    ...(event.previous ? { previous: event.previous.displayValue } : {}),
    ...(event.consensus ? { consensus: event.consensus.displayValue } : {}),
    surprise: surpriseView(surprise)
  })
}

function marketEvent(
  event: Extract<ReturnType<MarketIntelligencePublicQueryService['queryMarketCalendarMonth']>, { state: 'available' }>['events'][number],
  _asOf: string
): DailyBriefingCalendarEvent {
  const surprise = assessMarketCalendarSurprise(event.providerActual, event.consensus)
  return Object.freeze({
    eventKey: event.eventKey,
    title: event.title,
    ...(event.countryCode ? { countryCode: event.countryCode } : {}),
    ...(event.countryName ? { countryName: event.countryName } : {}),
    scheduledAt: event.scheduledAt,
    importance: event.importance,
    lifecycleState: event.providerActual ? 'released' as const : 'scheduled' as const,
    category: 'economic-indicator' as const,
    ...(event.providerActual ? { actual: event.providerActual.displayValue } : {}),
    ...(event.providerPrevious ? { previous: event.providerPrevious.displayValue } : {}),
    ...(event.consensus ? { consensus: event.consensus.displayValue } : {}),
    surprise: surpriseView(surprise)
  })
}

function surpriseView(
  assessment: ReturnType<typeof assessMarketCalendarSurprise>
): DailyBriefingCalendarEvent['surprise'] {
  return Object.freeze({
    direction: toCalendarSurpriseView(assessment),
    ...(assessment.presentation ? { value: assessment.presentation.value, unit: assessment.presentation.unit } : {}),
    ...(assessment.reason ? { reason: assessment.reason } : {})
  })
}

function calendarMonths(asOf: string): readonly string[] {
  const month = asOf.slice(0, 7)
  const [year, index] = month.split('-').map(Number) as [number, number]
  const previous = index === 1 ? `${year - 1}-12` : `${year}-${String(index - 1).padStart(2, '0')}`
  const next = index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, '0')}`
  return [previous, month, next]
}

