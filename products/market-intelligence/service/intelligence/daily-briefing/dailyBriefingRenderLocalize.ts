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
  enabled: boolean
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
  // 这里曾经有一条"补问"：对窗口内没拿到实际值的高影响事件，再按 `事件时刻 + 1 小时` 那个快照读一次。
  // 那条路注定补不进来——晚到的小时级、天级回补都落在那个快照之后，永远查不到（2026-11-05 的 9 条
  // 事件就是这么"消失"的）。现在读数那一刻就是运行时刻、读的是最新库，一次读已经覆盖"此刻库里
  // 有什么"；再按旧时刻问一遍只会拿回更旧的世界。删掉它，不留一条永远走不通的路。
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
  // 惯例推算的时刻**不是发布时刻**（`MI-1-R39` §4）：官方没公布（`convention-default`）或源里
  // 根本没有时刻（`date-only`）时，一律不许把它填进 `scheduledAt`——那等于把一个假时刻顶掉
  // 另一个假时刻。剩下的只是一个**日期位**给排序与分栏用，印刷面另带标记，只画日期 + 一句话。
  const published = event.releaseTimeSource === 'convention-default' ? undefined : event.scheduledAt
  const scheduledAt = published ?? `${event.scheduledDate}T00:00:00.000Z`
  const surprise = assessMarketCalendarSurprise(event.actual, event.consensus)
  return Object.freeze({
    eventKey: event.eventKey,
    title: event.titleKey,
    titleKey: event.titleKey,
    countryCode: event.countryCode,
    scheduledAt,
    ...(published === undefined ? { releaseTimeNotPublished: true as const, releaseDate: event.scheduledDate } : {}),
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
    // 日历源自己就分了类（`eventType`）：讲话、发布会、利率决议是央行活动，别的公告是财经事件。
    // 这里以前对所有事件都写死 `economic-indicator`，于是上面那层"隐藏央行活动与财经事件"的过滤
    // **一条都拦不住**——它拿到的永远是同一个类别（2026-11-06 读者看到的 7 条讲话就是这么漏出来的）。
    // 只按源给的类别走，别再自己归类。
    category: event.eventType,
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

