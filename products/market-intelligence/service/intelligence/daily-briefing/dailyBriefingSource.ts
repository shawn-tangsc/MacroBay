import type { AnalysisConclusionDirection, AnalysisSummary, Prediction } from '../../../contracts/marketAnalysisContracts'
import type { CapitalConditionsSnapshotResult } from '../../../contracts/intelligenceQueryContracts'
import type { MarketAnalysisRepository } from '../store/marketAnalysisRepository'
import type { MarketIntelligencePublicQueryService } from '../public-query/publicQueryService'
import type { MacroHistoryAsOfReading, MacroHistoryAsOfSeries } from '../public-query/macroHistoryAsOf'
import type { createNewsSentimentQuery } from '../news-sentiment/newsSentimentQuery'
import type { SourceProfileStore } from '../application/sourceProfileStore'
import { assessMarketCalendarSurprise, toCalendarSurpriseView } from '../../../contracts/macro/marketCalendarSurprise'
import { selectLatestPublishedEntry } from '../../../contracts/latestPublishedAnalysis'
import type { DailyBriefingCalendarEvent, DailyBriefingFactPacket } from './dailyBriefingFactPacket'
import type { DailyBriefingFactSnapshot, TimelineItem } from './dailyBriefingFactSnapshot'
import { dailyBriefingPolicy, isDailyBriefingWindowHours, type DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingSource, DailyBriefingStore, DailyBriefingStoredEdition } from './dailyBriefingService'
import { dailyBriefingEnabledFromProfiles, type DailyBriefingEnabledFlags } from './dailyBriefingReadingSources'
import { DAY_MS, HOUR_MS, safe, safeSync } from './dailyBriefingSafeRead'
import { readCalendar, readPriorConclusions } from './dailyBriefingRenderLocalize'
import {
  collectAnalysisPriorConclusions,
  collectBriefingPriorConclusions,
  mergePriorConclusions
} from './dailyBriefingPriorConclusions'


/** The news port the source reads; exported so a build without a news query can supply the "no news" answer. */
export type NewsQuery = Pick<ReturnType<typeof createNewsSentimentQuery>, 'query'>

export type DailyBriefingSourceDeps = Readonly<{
  repository: Pick<MarketAnalysisRepository, 'listTimeline' | 'getSummary' | 'listPredictions' | 'getRun' | 'getSnapshot'>
  publicQuery: Pick<MarketIntelligencePublicQueryService,
    | 'queryFearGreedSnapshot'
    | 'queryFundingRateHistory'
    | 'queryCapitalConditionsSnapshot'
    | 'queryOpenInterestHistory'
    | 'queryCrossAssetSnapshot'
    | 'queryMacroHistoryAsOf'
    | 'queryMacroRatesSnapshot'
    | 'queryMacroEconomicCalendarMonth'
    | 'queryMarketCalendarMonth'
    | 'getCrossAssetQueryFailure'>
  news: NewsQuery
  profiles: Pick<SourceProfileStore, 'listProfiles'>
  policyPathQuery?: { read: (input: { asOf: string }) => import('../policy-path/policyPathQueryService').PolicyPathReading | undefined }
  /**
   * Stored brief editions, read-only. Optional so a build without a briefing store still produces a
   * packet; the window then carries analysis conclusions only.
   */
  briefEditions?: Pick<DailyBriefingStore, 'list'>
}>

/**
 * Reads the existing surfaces into one frozen packet. Every read is isolated: a dead feed becomes a
 * stated gap in the document, never a failed generation. The source never triggers a collection.
 */
export function createDailyBriefingSource(deps: DailyBriefingSourceDeps): DailyBriefingSource {
  return {
    async readFacts(input) {
      const enabled = await readEnabled(deps)
      // The reader's statistical window decides the fact interval; every window-scoped read below
      // uses it instead of assuming 24 hours.
      const windowHours = isDailyBriefingWindowHours(input.windowHours) ? input.windowHours : dailyBriefingPolicy.windowHours
      const windowStart = new Date(Date.parse(input.asOf) - windowHours * HOUR_MS).toISOString()
      const policyPath = deps.policyPathQuery?.read({ asOf: input.asOf })
      // One timeline read feeds both the fact-layer conclusion and the window's prior conclusions:
      // two reads could disagree about which nodes are visible at the cutoff.
      const timeline = readTimeline(deps)
      const [conclusion, news, fearGreed, funding, capital, crossAsset, macroMarket, macroRates, positioning] = await Promise.all([
        readConclusion(deps, input.asOf, timeline),
        readNews(deps, input.asOf, windowStart),
        safe(() => deps.publicQuery.queryFearGreedSnapshot({ asOf: input.asOf }), unavailableFearGreed()),
        safe(() => deps.publicQuery.queryFundingRateHistory({ asOf: input.asOf }), unavailableFunding()),
        safe(() => deps.publicQuery.queryCapitalConditionsSnapshot({ asOf: input.asOf, allowStale: true }), unavailableCapital()),
        safe(() => deps.publicQuery.queryCrossAssetSnapshot({ range: '24h', asOf: input.asOf }), undefined),
        buildMacroMarketAsOf(deps, input.asOf),
        ratesAsOf(safeSync(() => deps.publicQuery.queryMacroRatesSnapshot(), undefined), input.asOf),
        safe(() => deps.publicQuery.queryOpenInterestHistory({ asOf: input.asOf, window: '24h' }), undefined)
      ])
      return Object.freeze({
        asOf: input.asOf,
        windowStart,
        windowEnd: input.asOf,
        windowHours,
        timeline,
        conclusion,
        news,
        readings: Object.freeze({ fearGreed, funding, capital: capitalAsOf(capital, input.asOf) }),
        ...(positioning ? { positioning } : {}),
        ...(policyPath ? { policyPath } : {}),
        market: Object.freeze({
          ...(crossAsset ? { crossAsset } : {}),
          ...(!crossAsset && deps.publicQuery.getCrossAssetQueryFailure?.()
            ? { crossAssetFailure: deps.publicQuery.getCrossAssetQueryFailure() ?? undefined }
            : {}),
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
    },
    async renderPacket(facts, locale, timeZone) {
      // The localized layer: only text and the reader's own prior conclusions come from here. No
      // number, row order or cutoff is read a second time.
      const [priorConclusions, calendar] = await Promise.all([
        readPriorConclusions(deps, facts.timeline, facts.asOf, facts.windowStart, locale),
        readCalendar(deps, facts.asOf, locale, facts.enabled.calendar, facts.windowStart)
      ])
      return Object.freeze({
        ...facts,
        locale,
        timeZone,
        priorConclusions,
        calendar
      })
    }
  }
}

export async function readNews(deps: DailyBriefingSourceDeps, asOf: string, windowStart: string): Promise<DailyBriefingFactPacket['news']> {
  try {
    // The query only supports fixed horizons, so ask for the smallest one that covers the window
    // and keep the configured interval: a 12h brief must not carry yesterday's headlines, and a 48h
    // brief must not silently shrink back to 24h.
    const window = Date.parse(asOf) - Date.parse(windowStart) > 24 * HOUR_MS ? '7d' as const : '24h' as const
    const view = await deps.news.query({ asOf, window, limit: 100 })
    return Object.freeze({
      state: view.state,
      items: view.items.filter((item) => item.publishedAt >= windowStart && item.publishedAt <= asOf)
    })
  } catch {
    return Object.freeze({ state: 'unavailable' as const, items: Object.freeze([]) })
  }
}

async function readEnabled(deps: DailyBriefingSourceDeps): Promise<DailyBriefingEnabledFlags> {
  try {
    return dailyBriefingEnabledFromProfiles(await deps.profiles.listProfiles())
  } catch {
    return dailyBriefingEnabledFromProfiles(undefined)
  }
}

export type { TimelineItem } from './dailyBriefingFactSnapshot'

function readTimeline(deps: DailyBriefingSourceDeps): readonly TimelineItem[] {
  try {
    return deps.repository.listTimeline({ limit: 50 }).items
  } catch {
    return Object.freeze([])
  }
}

async function readConclusion(
  deps: DailyBriefingSourceDeps,
  cutoff: string,
  timeline: readonly TimelineItem[]
): Promise<DailyBriefingFactPacket['conclusion']> {
  try {
    const cutoffMs = Date.parse(cutoff)
    const eligible = Number.isFinite(cutoffMs)
      ? timeline.filter((item) => !item.occurredAt || Date.parse(item.occurredAt) <= cutoffMs)
      : timeline
    const latest = selectLatestPublishedEntry(eligible)
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

/**
 * The window's earlier AI conclusions, claims rather than facts.
 *
 * Analysis conclusions are read from the same timeline page as the fact-layer conclusion; brief
 * conclusions come from the stored editions, which are date-keyed and therefore filtered again by
 * their own `windowEnd`. A failed read is an empty list: a brief without prior conclusions is still
 * valid, and it says `fallback` instead of pretending it synthesized something.
 */
function unavailableFearGreed() {
  return { state: 'unavailable' as const, failureCode: 'fear-greed-query-unavailable' as const }
}

function unavailableFunding() {
  return { state: 'unavailable' as const, failureCode: 'funding-rate-history-query-unavailable' as const }
}

function unavailableCapital() {
  return { state: 'unavailable' as const, failureCode: 'capital-conditions-query-unavailable' as const }
}

/**
 * The dollar and gold as they stood at the cutoff.
 *
 * The product-wide macro snapshot is a single *current* read: it carries the 21:00 market, so using
 * it for an 08:00 edition either prints the wrong instant or — when its own `asOf` is checked — drops
 * the row to `—` while the conclusion still cites the same series. Both are the masquerade this
 * builder removes. The stored history answers the cutoff itself, so the card, the conclusion and the
 * backfill tool all read one projection at one instant.
 *
 * The projection's own `returns` travel with the level: a window the store cannot answer at the
 * cutoff stays absent, and the row prints a level rather than a change measured over whatever bar
 * happened to be stored. A synthesised dollar keeps its `synthetic` tag, which is what the row label
 * reads.
 */
function buildMacroMarketAsOf(
  deps: DailyBriefingSourceDeps,
  cutoff: string
): DailyBriefingFactPacket['market']['macroMarket'] {
  const dxy = macroReadingAsOf(deps, 'dxy', cutoff)
  const gold = macroReadingAsOf(deps, 'gold', cutoff)
  const readings = [dxy, gold]
    .filter((reading): reading is MacroHistoryAsOfReading => reading !== undefined)
    .map((reading) => Object.freeze({
      seriesId: reading.seriesId,
      level: reading.value,
      atMs: Date.parse(reading.observedAt),
      returns: Object.freeze({ ...(reading.returns ?? {}) }),
      ...(reading.synthetic ? { synthetic: true as const } : {})
    }))
  if (readings.length === 0) return undefined
  return Object.freeze({
    state: 'available' as const,
    asOf: cutoff,
    readings: Object.freeze(readings),
    caveats: Object.freeze(readings.some((reading) => 'synthetic' in reading)
      ? ['synthetic-dollar-index' as const]
      : [])
  })
}

function macroReadingAsOf(
  deps: DailyBriefingSourceDeps,
  series: Extract<MacroHistoryAsOfSeries, 'dxy' | 'gold'>,
  cutoff: string
): MacroHistoryAsOfReading | undefined {
  const reading = safeSync(() => deps.publicQuery.queryMacroHistoryAsOf({ series, asOf: cutoff }), undefined)
  if (!reading || reading.state !== 'available') return undefined
  // The reader already refuses a point after the instant; repeating the gate here means a miswired
  // or future-dated projection can never become a card value.
  if (reading.asOf !== cutoff) return undefined
  if (!Number.isFinite(reading.value) || !Number.isFinite(Date.parse(reading.observedAt))) return undefined
  return reading.observedAt <= cutoff ? reading : undefined
}

/**
 * The packet's last as-of gate for the capital rows.
 *
 * The capital query prefers stored history at or before the instant and fails closed otherwise, but
 * a stale slice of the packet must never carry a snapshot verified after the cutoff: that is the
 * current state, not the cutoff's fact. A late core snapshot becomes a stated empty reading (the
 * row prints a gap), and a late ETF window becomes `unavailable` rather than a card that disagrees
 * with the conclusion.
 */
function capitalAsOf(result: CapitalConditionsSnapshotResult, cutoff: string): CapitalConditionsSnapshotResult {
  if (result.state !== 'available') return result
  const core = result.coreStablecoins
  if (core.observedAt > cutoff || core.verifiedAt > cutoff) {
    return Object.freeze({ state: 'empty' as const, asOf: cutoff })
  }
  if (result.etf.state !== 'available') return result
  const etf = result.etf
  const late = etf.verifiedAt > cutoff ||
    [...etf.btc.rows, ...etf.eth.rows].some((row) => row.observedAt > cutoff)
  return late
    ? Object.freeze({ ...result, etf: Object.freeze({ state: 'unavailable' as const }) })
    : result
}

/**
 * FRED publishes one close per trading day, stamped with that day rather than an instant, so the
 * snapshot's own `asOf` (the read time) cannot decide visibility. A daily close for day D is the
 * close of D: it is known once D has ended in UTC, and never before.
 *
 * Generating a 08:00 edition at 21:00 therefore keeps D-1's close and drops D's, instead of either
 * dropping the whole block (which loses a figure that really was known) or publishing the current
 * snapshot as if it had been read at 08:00 (which is the masquerade this guards against). A block
 * with no visible close stays `empty`, not "available with old numbers".
 */
function ratesAsOf(
  snapshot: NonNullable<ReturnType<MarketIntelligencePublicQueryService['queryMacroRatesSnapshot']>> | undefined,
  cutoff: string
): NonNullable<ReturnType<MarketIntelligencePublicQueryService['queryMacroRatesSnapshot']>> | undefined {
  if (!snapshot || snapshot.state === 'unavailable') return snapshot
  const cutoffMs = Date.parse(cutoff)
  if (!Number.isFinite(cutoffMs)) return undefined
  const readings = snapshot.readings.filter((reading) => {
    const dayEndMs = Date.parse(`${reading.period}T00:00:00.000Z`) + DAY_MS
    return Number.isFinite(dayEndMs) && dayEndMs <= cutoffMs
  })
  return Object.freeze({
    ...snapshot,
    asOf: cutoff,
    state: readings.length > 0 ? 'available' as const : 'empty' as const,
    readings: Object.freeze(readings)
  })
}
