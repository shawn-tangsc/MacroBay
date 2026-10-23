import { createHash } from 'node:crypto'

import {
  isMarketCalendarPage,
  marketCalendarPublicPolicy,
  type MarketCalendarEvent,
  type MarketCalendarPage
} from '../../../contracts/macro/marketCalendarQueryContracts'
import type {
  MacroEconomicCalendarEventView,
  MacroEconomicCalendarValueView
} from '../../../contracts/macro/economicCalendarQueryContracts'

/**
 * The official event view asserts a US-only official identity (`countryCode: 'US'`,
 * `importance: 'high'`) because every official calendar source is a US release. A 0xRouter
 * observation has a different identity: its storage policy keeps `identityState:
 * 'unverified'` and `officialLink: 'disabled'`, and provider rows carry other countries and
 * other importance levels. Promoting an observation into those official literals would be
 * exactly the identity promotion the storage policy forbids, so only those two fields are
 * widened here. Every other field is the official contract verbatim, which keeps official
 * events assignable to this type and keeps one fact projection for both routes.
 */
export type MacroCalendarProviderObservation =
  Omit<MacroEconomicCalendarEventView, 'countryCode' | 'importance'> &
  Readonly<{ countryCode: string | null; importance: 'high' | 'medium' | 'low' }>

export type MacroCalendarProviderObservationSet = Readonly<{
  observations: readonly MacroCalendarProviderObservation[]
  caveats: readonly string[]
}>

export const marketCalendarObservationPolicy = Object.freeze({
  /** Analysis facts are produced for the product's primary calendar locale. */
  locale: 'zh' as const,
  /**
   * Bounded follow of the public page cursor. One page admits at most
   * `marketCalendarPublicPolicy.maximumEvents` (100) observations and the three descriptors
   * share one paging position, so twelve pages cover a provider month of roughly six hundred
   * rows without an unbounded read. Four did not: the cursor ran out before the end of the
   * month, so the second half of it — including the releases the reader was waiting for — never
   * became a candidate, and `caveats.pagesTruncated` said so without anyone acting on it.
   * The pages are candidates for the admission cap below, not facts by themselves.
   */
  maximumPages: 12,
  /**
   * Bounded admission into the analysis fact set.
   *
   * The projection emits a fixed 7 metrics per calendar event and the analysis context keeps
   * only 160 facts, ordered macro-first (newest first within the domain, capped at 90 macro
   * facts). A provider month is measured in hundreds of rows, so an unbounded merge fills the
   * whole context with calendar facts and drops capital, sentiment and funding evidence while
   * the domain access matrix still reports them as available.
   *
   * Sixteen, not eight: the admission is ranked (see `admissionRank`), so the two or three
   * high-importance releases of a day plus the imminent high-importance ones have to fit. At
   * eight the newest release could be crowded out by a routine series that merely carried an
   * actual, and the analysis then described a market without the data the reader was watching.
   * Everything past the cap is reported through `caveats.observationsTruncated`, and the macro
   * fact cap still trims the oldest facts afterwards.
   */
  maximumObservations: 16,
  /** `market_fact_key` is a provider-tuple JSON string, so the public key is a digest of it. */
  eventKeyPrefix: 'market-observation-',
  eventKeyDigestCharacters: 32,
  /**
   * Values are present but the observation identity is unverified, so this route must not
   * claim full official-grade coverage for the month.
   */
  coverage: 'partial' as const,
  caveats: Object.freeze({
    coverageUnverified: 'observed-unverified',
    titleIsProviderDisplayName: 'provider-title-is-display-name',
    surpriseNotComparable: 'provider-surprise-not-comparable',
    identityMissing: 'provider-observation-identity-missing',
    pageUnavailable: 'provider-observation-page-unavailable',
    pagesTruncated: 'provider-observation-pages-truncated',
    observationsTruncated: 'provider-observations-truncated'
  }),
  surprise: Object.freeze({
    /**
     * Signed decimal or percent only. Provider values are display strings that never passed
     * unit admission, so `250K`, `1.2M` and ranges are deliberately not compared.
     */
    comparableValuePattern: /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/,
    percentSuffix: '%',
    /** No numeric tolerance is admitted: the provider row has no admitted unit. */
    inlineToleranceAbsolute: 0
  })
})

/**
 * Provider kind to analysis family. These three provider kinds are the families this route
 * admits; no official family (`consumer-price-index`, `employment-situation`, ...) is
 * guessed, because that mapping belongs to the official link that is not admitted here.
 */
const eventFamilyByEventType: Readonly<Record<MarketCalendarEvent['eventType'], string>> = Object.freeze({
  'economic-indicator': 'economic-indicator',
  'financial-event': 'financial-event',
  'central-bank-activity': 'central-bank-activity'
})

/** Reuses the contract's own kind/descriptor alignment instead of restating it. */
const providerIdByEventType: Readonly<Record<MarketCalendarEvent['eventType'], string>> = Object.freeze(
  Object.fromEntries(marketCalendarPublicPolicy.kinds.map(
    (kind, index) => [kind, marketCalendarPublicPolicy.descriptors[index]!]
  )) as Record<MarketCalendarEvent['eventType'], string>
)

/**
 * Stable public identity of one provider observation. `eventKey` on the market page is an
 * HMAC of the per-batch `observation_id` and changes on every collection, so the analysis
 * identity is derived from `observationKey` (`market_fact_key`) instead. The digest keeps
 * the provider tuple out of fact and evidence identifiers.
 */
export function marketCalendarObservationEventKey(observationKey: string): string {
  return marketCalendarObservationPolicy.eventKeyPrefix + createHash('sha256')
    .update(observationKey).digest('hex').slice(0, marketCalendarObservationPolicy.eventKeyDigestCharacters)
}

/** The expected difference. Absent or incomparable inputs stay `consensus-unavailable`. */
export function marketCalendarSurprise(
  actual: MacroEconomicCalendarValueView | undefined,
  consensus: MacroEconomicCalendarValueView | null | undefined
): MacroEconomicCalendarEventView['surprise'] {
  const left = actual ? comparableMagnitude(actual) : undefined
  const right = consensus ? comparableMagnitude(consensus) : undefined
  if (!left || !right || left.suffix !== right.suffix) return 'consensus-unavailable'
  const difference = left.magnitude - right.magnitude
  if (Math.abs(difference) <= marketCalendarObservationPolicy.surprise.inlineToleranceAbsolute) return 'inline'
  return difference > 0 ? 'beat' : 'miss'
}

/**
 * How far a provider release landed from the market's expectation, when the two are comparable.
 *
 * 设计 145 §8 A / 146 §2 选项 3 要的是"显著偏离预期"这个**量**，而 `marketCalendarSurprise` 只回
 * beat/miss/inline。两者共用同一套可比性规则（同一单位后缀、只看带符号数字），所以这里不另立解析：
 * 单位不可比时同样返回 `undefined`，调用方按"不能判断"处理。
 *
 * `relative` 是相对预期的偏离比例，只在预期不为 0 时有值：provider 的 displayValue 没有单位准入，
 * 分不出"千人"与"万人"，百分数之外只能按相对量判断。
 */
export function marketCalendarSurpriseMagnitude(
  actual: MacroEconomicCalendarValueView | undefined,
  consensus: MacroEconomicCalendarValueView | null | undefined
): Readonly<{ difference: number; suffix: string; relative: number | undefined }> | undefined {
  const left = actual ? comparableMagnitude(actual) : undefined
  const right = consensus ? comparableMagnitude(consensus) : undefined
  if (!left || !right || left.suffix !== right.suffix) return undefined
  const difference = left.magnitude - right.magnitude
  return Object.freeze({
    difference,
    suffix: left.suffix,
    relative: right.magnitude === 0 ? undefined : difference / Math.abs(right.magnitude)
  })
}

function comparableMagnitude(value: MacroEconomicCalendarValueView): { magnitude: number; suffix: string } | undefined {
  const text = value.displayValue.trim()
  const suffix = text.endsWith(marketCalendarObservationPolicy.surprise.percentSuffix)
    ? marketCalendarObservationPolicy.surprise.percentSuffix : ''
  const digits = suffix ? text.slice(0, -suffix.length) : text
  if (!marketCalendarObservationPolicy.surprise.comparableValuePattern.test(digits)) return undefined
  const magnitude = Number(digits)
  return Number.isFinite(magnitude) ? { magnitude, suffix } : undefined
}

/** `2026-09-10T12:30:00.000Z` -> `2026-M09`, the official period key shape. */
function periodKeyFor(scheduledAt: string): string {
  return `${scheduledAt.slice(0, 4)}-M${scheduledAt.slice(5, 7)}`
}

/**
 * Maps one admitted 0xRouter observation onto the fact projection. Returns `undefined` when
 * the observation carries no stable identity: without it the analysis would report the same
 * event as new on every collection, which is worse than reporting the gap.
 */
export function normalizeMarketCalendarEvent(event: MarketCalendarEvent): MacroCalendarProviderObservation | undefined {
  const observationKey = event.observationKey
  if (!observationKey) return undefined
  const actual = event.providerActual
  const previous = event.providerPrevious
  const consensus = event.consensus
  const surprise = marketCalendarSurprise(actual ?? undefined, consensus)
  const caveats: string[] = [
    marketCalendarObservationPolicy.caveats.coverageUnverified,
    marketCalendarObservationPolicy.caveats.titleIsProviderDisplayName
  ]
  if (actual && consensus && surprise === 'consensus-unavailable') {
    caveats.push(marketCalendarObservationPolicy.caveats.surpriseNotComparable)
  }
  const eventKey = marketCalendarObservationEventKey(observationKey)
  return {
    eventKey,
    // No official release grouping is admitted for an unverified observation, so the
    // observation is its own group, exactly as the official Fed FOMC branch does.
    releaseGroupKey: eventKey,
    eventFamily: eventFamilyByEventType[event.eventType],
    titleKey: event.title,
    countryCode: event.countryCode,
    importance: event.importance,
    periodKey: periodKeyFor(event.scheduledAt),
    lifecycleState: actual ? 'released' : 'scheduled',
    coverage: marketCalendarObservationPolicy.coverage,
    scheduledDate: event.scheduledAt.slice(0, 10),
    scheduledAt: event.scheduledAt,
    // These are the provider's own observations, not an official release schedule: this projection
    // carries no BLS/Fed convention and no reader edit, so it claims neither.
    releaseTimeSource: 'date-only' as const,
    detectedAt: event.sourceObservedAt,
    ...(actual ? { actual } : {}),
    ...(previous ? { previous } : {}),
    consensus,
    consensusState: consensus ? 'available' : 'unavailable',
    surprise,
    providerIds: [providerIdByEventType[event.eventType]],
    caveats
  }
}

/**
 * Relevance order for the bounded admission.
 *
 * Importance first, then whether the row carries anything at all, then closeness to the analysis
 * instant, then "carries an actual", then the stable key so the selection is deterministic.
 *
 * Both terms were learned from the reader's own store. Without importance first, a month of
 * already-released medium-importance series sorted ahead of the morning's CPI. With "carries an
 * actual" ahead of closeness, every high-importance number of the past week outranked the release
 * about to be published — so the imminent event was missing from the snapshot, and an event missing
 * from the snapshot can never be reported as changed once its actual arrives.
 */
function admissionRank(observation: MacroCalendarProviderObservation, asOf: string): readonly [number, number, number, number, string] {
  const distance = Date.parse(observation.scheduledAt ?? '')
  return [
    observation.importance === 'high' ? 0 : observation.importance === 'medium' ? 1 : 2,
    // Carries anything at all: an actual, an expectation or a previous value. A near-term row with
    // none of them is a placeholder and must not spend a slot.
    observation.actual || observation.consensus || observation.previous ? 0 : 1,
    // Closeness, not "carries an actual". An actual is only new information while the release is
    // recent: ranking it as its own tier put every high-importance number of the past week ahead of
    // the one about to be published — verified against the real pre-release snapshot, where the
    // morning's CPI (1.5h away) ranked 36th of 565 behind releases 150 hours old.
    Number.isFinite(distance) ? Math.abs(distance - Date.parse(asOf)) : Number.MAX_SAFE_INTEGER,
    observation.actual ? 0 : 1,
    observation.eventKey
  ]
}

function compareAdmissionRank(left: readonly [number, number, number, number, string], right: readonly [number, number, number, number, string]): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2] || left[3] - right[3] || left[4].localeCompare(right[4])
}

/**
 * Reads the 0xRouter public month page and normalizes it for the fact projection. A page
 * that is unusable or malformed contributes no observation and one named caveat instead of
 * failing the whole macro domain, which keeps the official route usable on its own.
 */
export function readMarketCalendarObservations(
  query: (input: unknown) => MarketCalendarPage,
  scope: Readonly<{ month: string; asOf: string }>
): MacroCalendarProviderObservationSet {
  const caveats = new Set<string>()
  const candidates: MacroCalendarProviderObservation[] = []
  const seen = new Set<string>()
  try {
    let cursor: string | undefined
    let pages = 0
    do {
      const request = { month: scope.month, locale: marketCalendarObservationPolicy.locale,
        asOf: scope.asOf, ...(cursor ? { cursor } : {}) }
      const page = query(request)
      if (!isMarketCalendarPage(page, request) || page.state !== 'available') {
        caveats.add(marketCalendarObservationPolicy.caveats.pageUnavailable)
        break
      }
      for (const event of page.events) {
        const observation = normalizeMarketCalendarEvent(event)
        if (!observation) { caveats.add(marketCalendarObservationPolicy.caveats.identityMissing); continue }
        if (seen.has(observation.eventKey)) continue
        seen.add(observation.eventKey)
        candidates.push(observation)
      }
      cursor = page.nextCursor
      pages += 1
      if (cursor && pages >= marketCalendarObservationPolicy.maximumPages) {
        caveats.add(marketCalendarObservationPolicy.caveats.pagesTruncated)
        break
      }
    } while (cursor)
  } catch {
    caveats.add(marketCalendarObservationPolicy.caveats.pageUnavailable)
  }
  const admitted = candidates
    .map(observation => ({ observation, rank: admissionRank(observation, scope.asOf) }))
    .sort((left, right) => compareAdmissionRank(left.rank, right.rank))
    .slice(0, marketCalendarObservationPolicy.maximumObservations)
  if (admitted.length < candidates.length) caveats.add(marketCalendarObservationPolicy.caveats.observationsTruncated)
  return { observations: admitted.map(entry => entry.observation), caveats: [...caveats] }
}
