import type { AnalysisConclusionDirection, AnalysisSummary, Prediction } from '../../../contracts/marketAnalysisContracts'
import type { MarketAnalysisRepository } from '../store/marketAnalysisRepository'
import type { MarketIntelligencePublicQueryService } from '../public-query/publicQueryService'
import type { createNewsSentimentQuery } from '../news-sentiment/newsSentimentQuery'
import type { SourceProfileStore } from '../application/sourceProfileStore'
import { assessMarketCalendarSurprise, toCalendarSurpriseView } from '../../../contracts/macro/marketCalendarSurprise'
import { selectLatestPublishedEntry } from '../../../contracts/latestPublishedAnalysis'
import type { DailyBriefingCalendarEvent, DailyBriefingFactPacket } from './dailyBriefingFactPacket'
import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingSource } from './dailyBriefingService'
import { dailyBriefingEnabledFromProfiles, type DailyBriefingEnabledFlags } from './dailyBriefingReadingSources'

const WINDOW_MS = 24 * 60 * 60 * 1_000

type NewsQuery = Pick<ReturnType<typeof createNewsSentimentQuery>, 'query'>

export type DailyBriefingSourceDeps = Readonly<{
  repository: Pick<MarketAnalysisRepository, 'listTimeline' | 'getSummary' | 'listPredictions' | 'getRun' | 'getSnapshot'>
  publicQuery: Pick<MarketIntelligencePublicQueryService,
    | 'queryFearGreedSnapshot'
    | 'queryFundingRateHistory'
    | 'queryCapitalConditionsSnapshot'
    | 'queryCrossAssetSnapshot'
    | 'queryMacroMarketSnapshot'
    | 'queryMacroRatesSnapshot'
    | 'queryMacroEconomicCalendarMonth'
    | 'queryMarketCalendarMonth'>
  news: NewsQuery
  profiles: Pick<SourceProfileStore, 'listProfiles'>
}>

/**
 * Reads the existing surfaces into one frozen packet. Every read is isolated: a dead feed becomes a
 * stated gap in the document, never a failed generation. The source never triggers a collection.
 */
export function createDailyBriefingSource(deps: DailyBriefingSourceDeps): DailyBriefingSource {
  return {
    async buildPacket(input) {
      const enabled = await readEnabled(deps)
      const [conclusion, news, fearGreed, funding, capital, calendar, crossAsset, macroMarket, macroRates] = await Promise.all([
        readConclusion(deps),
        readNews(deps, input.asOf),
        safe(() => deps.publicQuery.queryFearGreedSnapshot({ asOf: input.asOf }), unavailableFearGreed()),
        safe(() => deps.publicQuery.queryFundingRateHistory({ asOf: input.asOf }), unavailableFunding()),
        safe(() => deps.publicQuery.queryCapitalConditionsSnapshot({ asOf: input.asOf }), unavailableCapital()),
        readCalendar(deps, input.asOf, input.locale, enabled.calendar),
        safe(() => deps.publicQuery.queryCrossAssetSnapshot({ range: '24h', asOf: input.asOf }), undefined),
        safeSync(() => deps.publicQuery.queryMacroMarketSnapshot(), undefined),
        safeSync(() => deps.publicQuery.queryMacroRatesSnapshot(), undefined)
      ])
      const asOfMs = Date.parse(input.asOf)
      return Object.freeze({
        asOf: input.asOf,
        windowStart: new Date(asOfMs - WINDOW_MS).toISOString(),
        windowEnd: input.asOf,
        locale: input.locale,
        timeZone: input.timeZone,
        conclusion,
        news,
        calendar,
        readings: Object.freeze({ fearGreed, funding, capital }),
        market: Object.freeze({
          ...(crossAsset ? { crossAsset } : {}),
          ...(macroMarket ? { macroMarket } : {}),
          ...(macroRates ? { macroRates } : {})
        }),
        enabled: Object.freeze({
          fearGreed: enabled.fearGreed,
          funding: enabled.funding,
          stablecoin: enabled.stablecoin,
          etf: enabled.etf,
          calendar: enabled.calendar
        })
      })
    }
  }
}

async function readEnabled(deps: DailyBriefingSourceDeps): Promise<DailyBriefingEnabledFlags> {
  try {
    return dailyBriefingEnabledFromProfiles(await deps.profiles.listProfiles())
  } catch {
    return dailyBriefingEnabledFromProfiles(undefined)
  }
}

async function readConclusion(deps: DailyBriefingSourceDeps): Promise<DailyBriefingFactPacket['conclusion']> {
  try {
    const page = deps.repository.listTimeline({ limit: 50 })
    const latest = selectLatestPublishedEntry(page.items)
    if (!latest?.summaryRef) return null
    const summary: AnalysisSummary | undefined = deps.repository.getSummary(latest.summaryRef)
    if (!summary) return null
    const predictions: readonly Prediction[] = deps.repository.listPredictions(latest.summaryRef)
    const run = latest.analysisRunId ? deps.repository.getRun(latest.analysisRunId) : undefined
    const snapshot = run?.snapshotId ? deps.repository.getSnapshot(run.snapshotId) : undefined
    return Object.freeze({
      summary,
      predictions,
      evidenceRefs: snapshot?.evidenceRefs ?? [],
      occurredAt: latest.occurredAt,
      direction: (latest.direction ?? null) as AnalysisConclusionDirection | null
    })
  } catch {
    return null
  }
}

async function readNews(deps: DailyBriefingSourceDeps, asOf: string): Promise<DailyBriefingFactPacket['news']> {
  try {
    const view = await deps.news.query({ asOf, window: '24h', limit: 100 })
    return Object.freeze({ state: view.state, items: view.items })
  } catch {
    return Object.freeze({ state: 'unavailable' as const, items: Object.freeze([]) })
  }
}

async function readCalendar(
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
    const market = safeSync(
      () => deps.publicQuery.queryMarketCalendarMonth({ month, locale: locale === 'en-US' ? 'en' : 'zh', asOf }),
      undefined
    )
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
  return Object.freeze({
    state: available ? 'available' as const : 'unavailable' as const,
    events: Object.freeze([...events.values()])
  })
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

function calendarMonths(asOf: string): readonly [string, string] {
  const month = asOf.slice(0, 7)
  const [year, index] = month.split('-').map(Number) as [number, number]
  const next = index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, '0')}`
  return [month, next]
}

async function safe<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read()
  } catch {
    return fallback
  }
}

function safeSync<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
}

function unavailableFearGreed() {
  return { state: 'unavailable' as const, failureCode: 'fear-greed-query-unavailable' as const }
}

function unavailableFunding() {
  return { state: 'unavailable' as const, failureCode: 'funding-rate-history-query-unavailable' as const }
}

function unavailableCapital() {
  return { state: 'unavailable' as const, failureCode: 'capital-conditions-query-unavailable' as const }
}
