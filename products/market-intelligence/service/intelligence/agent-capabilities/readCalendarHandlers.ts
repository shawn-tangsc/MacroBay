import { getIntelligenceModule } from '../intelligenceModule'
import { analysisModelVocabulary } from '../analysis/analysisModelVocabulary'
import {
  assessMarketCalendarSurprise,
  toCalendarSurpriseView
} from '../../../contracts/macro/marketCalendarSurprise'
import { macroCalendarProviderSettingsPolicy } from '../../../contracts/macro/economicCalendarQueryContracts'
import type { MacroCalendarOps } from './operationFacades'
import type {
  MacroCalendarInput,
  NewsSentimentInput,
  NewsSentimentItemInput,
  ReadHandlerDeps
} from './readHandlerContracts'

export async function handleQueryMacroCalendar(
  input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  const { month, asOf, from, to, maxEvents } = (input ?? {}) as MacroCalendarInput
  const queryService = getIntelligenceModule(deps.jobRuntime).publicQueryService
  const locale = (await deps.getAppLanguage()) === 'en-US' ? 'en' : 'zh'
  const caveats: string[] = []

  const official = await queryService.queryMacroEconomicCalendarMonth({
    month,
    asOf,
    ...(maxEvents === undefined ? {} : { maxEvents })
  })

  const market = readAllMarketCalendarPages(queryService, { month, asOf, locale })
  if (market.state === 'unavailable') caveats.push('market-calendar-unavailable')

  const officialEvents = filterCalendarEvents(readCalendarEvents(official), from, to)
  const marketEvents = filterCalendarEvents(market.events, from, to)
  if (officialEvents.length === 0) caveats.push('official-calendar-empty')
  if (marketEvents.length === 0) caveats.push('market-calendar-empty')

  const merged = [
    ...officialEvents.map((event) => summarizeCalendarEvent(event, 'official')),
    ...marketEvents.map((event) => summarizeCalendarEvent(event, 'market'))
  ].sort((left, right) => (left.scheduledAt ?? '').localeCompare(right.scheduledAt ?? ''))
  const limit = maxEvents ?? CALENDAR_DEFAULT_MAX_EVENTS
  // Without an explicit window a busy month overflows the cap. Keeping the events closest to the
  // query instant is the useful default: "what is scheduled around now" must not lose today behind
  // the first 120 entries of the month.
  const events = from || to
    ? merged.slice(0, limit)
    : nearestToInstant(merged, asOf, limit)

  // The raw pages carry provider identity, query envelopes and per-event provenance; the model only
  // needs the counts and the merged timeline, and the full pages overflow the tool size budget.
  return {
    state: events.length > 0 ? 'available' : 'empty',
    month,
    asOf,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    official: summarizeCalendarSide(official, officialEvents.length),
    market: { ...summarizeCalendarSide(market, marketEvents.length), pages: market.pages },
    events,
    truncated: merged.length > events.length,
    totalEvents: merged.length,
    caveats
  }
}

const CALENDAR_DEFAULT_MAX_EVENTS = 120
const CALENDAR_MAX_PAGES = 40
const CALENDAR_MAX_COLLECTED = 1_000

/**
 * The market query is paged by a byte budget, so one call only answers with the first page. A month
 * keeps every event, and the caller asking "what is scheduled today" must still see today's rows
 * even when they sit on a later page.
 */
function readAllMarketCalendarPages(
  queryService: ReturnType<typeof getIntelligenceModule>['publicQueryService'],
  input: { month: string; asOf: string; locale: 'zh' | 'en' }
): { state: 'available' | 'unavailable'; events: Array<Record<string, unknown>>; pages: number; failureCode?: string } {
  const events: Array<Record<string, unknown>> = []
  let cursor: string | undefined
  let pages = 0
  try {
    do {
      const page = queryService.queryMarketCalendarMonth({
        month: input.month,
        asOf: input.asOf,
        locale: input.locale,
        ...(cursor ? { cursor } : {})
      })
      if (!page || page.state !== 'available') {
        return {
          state: 'unavailable',
          events: [],
          pages,
          ...(page && typeof page.failureCode === 'string' ? { failureCode: page.failureCode } : {})
        }
      }
      pages += 1
      events.push(...readCalendarEvents(page))
      cursor = typeof page.nextCursor === 'string' ? page.nextCursor : undefined
    } while (cursor && pages < CALENDAR_MAX_PAGES && events.length < CALENDAR_MAX_COLLECTED)
    return { state: 'available', events, pages }
  } catch {
    return { state: 'unavailable', events: [], pages }
  }
}

function nearestToInstant<
  T extends { scheduledAt: string | null; scheduledDate?: string }
>(events: T[], asOf: string, limit: number): T[] {
  const asOfMs = Date.parse(asOf)
  if (!Number.isFinite(asOfMs) || events.length <= limit) return events.slice(0, limit)
  const pointMs = (event: T): number => {
    const point = event.scheduledAt ?? (event.scheduledDate ? `${event.scheduledDate}T00:00:00.000Z` : undefined)
    return point ? Date.parse(point) : Number.NaN
  }
  const distance = (event: T): number => {
    const ms = pointMs(event)
    return Number.isFinite(ms) ? Math.abs(ms - asOfMs) : Number.POSITIVE_INFINITY
  }
  return events
    .map((event, index) => ({ event, index, distance: distance(event) }))
    .sort((left, right) => left.distance - right.distance || left.index - right.index)
    .slice(0, limit)
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.event)
}

function filterCalendarEvents(
  events: Array<Record<string, unknown>>,
  from: string | undefined,
  to: string | undefined
): Array<Record<string, unknown>> {
  if (!from && !to) return events
  // Compare instants, not strings: `scheduledAt` is UTC while the caller's window may carry an
  // offset, and lexicographic comparison across offsets lands on the wrong day.
  const fromMs = from ? Date.parse(from) : undefined
  const toMs = to ? Date.parse(to) : undefined
  return events.filter((event) => {
    const scheduledAt = typeof event.scheduledAt === 'string' ? event.scheduledAt : undefined
    const scheduledDate = typeof event.scheduledDate === 'string' ? event.scheduledDate : undefined
    const point = scheduledAt ?? (scheduledDate ? `${scheduledDate}T00:00:00.000Z` : undefined)
    const pointMs = point ? Date.parse(point) : Number.NaN
    if (!Number.isFinite(pointMs)) return false
    if (fromMs !== undefined && pointMs < fromMs) return false
    if (toMs !== undefined && pointMs >= toMs) return false
    return true
  })
}

function summarizeCalendarSide(page: unknown, eventCount: number): {
  state: string
  eventCount: number
  failureCode?: string
} {
  const record = page && typeof page === 'object' ? (page as Record<string, unknown>) : {}
  const state = typeof record.state === 'string' ? record.state : 'unavailable'
  const failureCode = typeof record.failureCode === 'string' ? record.failureCode : undefined
  return { state, eventCount, ...(failureCode ? { failureCode } : {}) }
}

function readCalendarEvents(page: unknown): Array<Record<string, unknown>> {
  if (!page || typeof page !== 'object') return []
  const events = (page as { events?: unknown }).events
  if (!Array.isArray(events)) return []
  return events.filter((event): event is Record<string, unknown> => Boolean(event) && typeof event === 'object')
}

function summarizeCalendarEvent(
  event: Record<string, unknown>,
  source: 'official' | 'market'
): {
  source: 'official' | 'market'
  eventKey: string
  title: string
  scheduledAt: string | null
  scheduledDate?: string
  countryName?: string
  importance?: string
  lifecycleState?: string
  actual?: string
  previous?: string
  consensus?: string
  surprise: string
  surpriseValue?: number
  surpriseUnit?: 'pp' | 'relative-percent'
  surpriseReason?: string
} {
  const text = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined
  const displayValue = (value: unknown): string | undefined => {
    if (!value || typeof value !== 'object') return undefined
    return text((value as { displayValue?: unknown }).displayValue)
  }
  const titleKey = text(event.titleKey)
  const title = text(event.title) ?? text(event.name) ?? (titleKey ? analysisModelVocabulary.eventName[titleKey] ?? titleKey : '')
  // The two calendar routes name the same three values differently: the official view calls them
  // `actual` / `previous`, the market view `providerActual` / `providerPrevious`. Reading only the
  // official names silently dropped every market release value from this tool.
  const actual = displayValue(event.actual) ?? displayValue(event.providerActual)
  const previous = displayValue(event.previous) ?? displayValue(event.providerPrevious)
  const consensus = displayValue(event.consensus)
  const assessment = assessMarketCalendarSurprise(
    actual ? { displayValue: actual } : undefined,
    consensus ? { displayValue: consensus } : undefined
  )
  const presentation = assessment.presentation
  return {
    source,
    eventKey: text(event.eventKey) ?? '',
    title,
    scheduledAt: text(event.scheduledAt) ?? null,
    ...(text(event.scheduledDate) ? { scheduledDate: text(event.scheduledDate) } : {}),
    ...(text(event.countryName) ? { countryName: text(event.countryName) } : {}),
    ...(text(event.importance) ? { importance: text(event.importance) } : {}),
    ...(text(event.lifecycleState) ? { lifecycleState: text(event.lifecycleState) } : {}),
    ...(actual ? { actual } : {}),
    ...(previous ? { previous } : {}),
    ...(consensus ? { consensus } : {}),
    // The same contract the card, drawer and analysis facts read: direction always, magnitude and
    // unit only when the pair is comparable, and a reason when it is not.
    surprise: toCalendarSurpriseView(assessment),
    ...(presentation ? { surpriseValue: presentation.value, surpriseUnit: presentation.unit } : {}),
    ...(assessment.reason ? { surpriseReason: assessment.reason } : {})
  }
}

export async function handleGetCalendarState(
  _input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  let configuration: Awaited<ReturnType<MacroCalendarOps['readConfiguration']>>
  try {
    configuration = await deps.macroCalendarOps.readConfiguration()
  } catch {
    return {
      state: 'unavailable',
      providers: [],
      releaseTimes: [],
      caveats: ['calendar-state-unavailable']
    }
  }

  const providerIds = [
    ...new Set([
      ...macroCalendarProviderSettingsPolicy.providerIds,
      ...Object.keys(configuration.providers)
    ])
  ].sort()
  const providers = providerIds.map((providerId) => {
    const configured = Object.hasOwn(configuration.providers, providerId)
    return {
      providerId,
      enabled: configured ? configuration.providers[providerId] === true : null,
      configured
    }
  })
  const releaseTimes = Object.entries(configuration.releaseTimes)
    .map(([eventKey, value]) => ({
      eventKey,
      scheduledAt: value.scheduledAt,
      scheduledDate: value.scheduledDate
    }))
    .sort((left, right) => left.eventKey.localeCompare(right.eventKey))

  return { state: 'available', providers, releaseTimes, caveats: [] }
}

/**
 * Whether the channel is even open: configuration state, enabled flag, and the
 * lease. It is deliberately separate from the reading's quality — a closed channel
 * and a bad reading are different answers, and conflating them makes the model
 * blame the market for an interface that is not running.
 */
