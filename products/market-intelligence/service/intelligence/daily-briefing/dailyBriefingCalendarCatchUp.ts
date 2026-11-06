import {
  isMarketCalendarFreshness,
  marketCalendarPublicPolicy,
  type MarketCalendarCollectionFreshness,
  type MarketCalendarFreshness,
  type MarketCalendarRefreshNowResult
} from '../../../contracts/macro/marketCalendarQueryContracts'
import { BRIEFING_CALENDAR_STALE_AFTER_MS } from './dailyBriefingMacroEmptyReason'

/**
 * The calendar catch-up a run performs before it judges freshness (acceptance `A0.8`, plan B).
 *
 * Order is fixed: **read → catch up once → read again**, and only the second reading may decide.
 * The 2-hour threshold is measured against the run's own `dataAsOf`, never against the period's
 * nominal cutoff: on a backfill they differ, and measuring against the cutoff would produce an
 * edition that shows events while claiming it could not read them.
 *
 * Three rules this module exists to hold:
 *
 * 1. **A failed or slow catch-up never blocks the edition.** The budget is an upper bound, not a
 *    promise; whatever the outcome, the run goes on and the section says "not readable" with the
 *    right reason.
 * 2. **Timeout and failure are different statements.** The reader acts differently on "we ran out of
 *    time" and "the collection failed", so they stay separate verdicts all the way to the copy.
 * 3. **Nothing here may ever answer "there was nothing".** Only a fresh reading plus an empty window
 *    can say that, and that decision lives in `briefingMacroEmptyReason`.
 */

/** The whole budget for one catch-up; the three feeds share it, they do not each get one. */
export const BRIEFING_CALENDAR_CATCH_UP_TIMEOUT_MS = marketCalendarPublicPolicy.refreshNow.defaultTimeoutMs

/** The three 0xRouter feeds the brief may catch up. `fed`/`bea` are official-schedule covered. */
export const BRIEFING_CALENDAR_CATCH_UP_SOURCE_IDS = Object.freeze([
  'macro-calendar-0xrouter-economic-data',
  'macro-calendar-0xrouter-financial-events',
  'macro-calendar-0xrouter-central-bank-activities'
] as const)

export type BriefingCalendarCatchUp = Readonly<{
  state: 'skipped' | 'collected' | 'unchanged' | 'failed' | 'timeout'
  /** Only meaningful on `timeout`: how long we actually waited. */
  timeoutMs?: number
  failureCode?: string
}>

/**
 * What the run learned about the calendar, in the shape the reason codes are decided from.
 *
 * `not-wired` and `unavailable` are deliberately distinct here even though both reach the reader as
 * "not readable": one is a build-time wiring gap that a test constructs on purpose, the other is a
 * run-time failure. Collapsing them would hide the first forever.
 */
export type BriefingCalendarFreshnessReading = Readonly<{
  state: 'available' | 'unavailable' | 'not-wired' | 'source-disabled'
  lastCollectedAt?: string
  /** The latest attempt across the feeds, whatever its verdict; `lastAttemptFailed` pairs with it. */
  lastAttemptAt?: string
  lastAttemptFailed?: boolean
  catchUp?: BriefingCalendarCatchUp
}>

export type BriefingCalendarCatchUpDeps = Readonly<{
  /** The read-only freshness port. Absent means this build never wired the calendar runtime. */
  readFreshness?: () => Promise<unknown>
  /** The one write command the brief may run. Absent means the same thing, for the trigger. */
  refreshNow?: (input: { sourceIds: readonly string[]; timeoutMs: number }) => Promise<unknown>
  /** This run's own data cutoff (`A0.10`): the baseline freshness is measured from. */
  dataAsOf: string
  /** Whether the reader has the calendar source switched on at all. */
  enabled: boolean
}>

export async function ensureCalendarFreshForRun(
  deps: BriefingCalendarCatchUpDeps
): Promise<BriefingCalendarFreshnessReading> {
  if (!deps.enabled) return Object.freeze({ state: 'source-disabled' })
  // ① No reader: the composition never handed the calendar over. Answer "not wired" so the caller
  //    lands on "not readable" — never on "there was nothing".
  if (!deps.readFreshness) return Object.freeze({ state: 'not-wired' })

  const first = await readFreshness(deps.readFreshness)
  if (first.state !== 'available') return Object.freeze({ state: 'unavailable' })
  if (isFreshAt(first.lastCollectedAt, deps.dataAsOf)) {
    // Fresh already: skip the request. A catch-up nobody needed is a spent credit.
    return Object.freeze({ ...readingFrom(first), catchUp: Object.freeze({ state: 'skipped' as const }) })
  }
  // Stale but no command: the reading is still true, so report it and let the reason codes say
  // "stale". Nothing was attempted, and that is not a failure.
  if (!deps.refreshNow) return Object.freeze(readingFrom(first))

  const catchUp = await runCatchUp(deps.refreshNow)
  // ③ Judge only the reading that came *after* the catch-up. A pre-catch-up reading would let the
  //    edition claim stale data it just replaced, and vice versa.
  const second = await readFreshness(deps.readFreshness)
  const decided = second.state === 'available' ? second : first
  return Object.freeze({ ...readingFrom(decided), catchUp })
}

/** Whether the last successful collection is close enough to the run's data cutoff. */
export function isFreshAt(lastCollectedAt: string | null | undefined, dataAsOf: string): boolean {
  if (lastCollectedAt === null || lastCollectedAt === undefined) return false
  const age = Date.parse(dataAsOf) - Date.parse(lastCollectedAt)
  return Number.isFinite(age) && age <= BRIEFING_CALENDAR_STALE_AFTER_MS
}

async function runCatchUp(
  refreshNow: NonNullable<BriefingCalendarCatchUpDeps['refreshNow']>
): Promise<BriefingCalendarCatchUp> {
  let raw: unknown
  try {
    raw = await refreshNow({
      sourceIds: BRIEFING_CALENDAR_CATCH_UP_SOURCE_IDS,
      timeoutMs: BRIEFING_CALENDAR_CATCH_UP_TIMEOUT_MS
    })
  } catch (error) {
    // A command that threw is a failed collection, not a timeout: the two say different things.
    const message = error instanceof Error ? error.message : String(error)
    return Object.freeze({ state: 'failed' as const, failureCode: message.slice(0, 64) })
  }
  const verdict = raw as Partial<MarketCalendarRefreshNowResult> | undefined
  if (verdict?.state === 'collected' || verdict?.state === 'unchanged') {
    return Object.freeze({ state: verdict.state })
  }
  if (verdict?.state === 'timeout') {
    return Object.freeze({
      state: 'timeout' as const,
      timeoutMs: typeof verdict.timeoutMs === 'number' ? verdict.timeoutMs : BRIEFING_CALENDAR_CATCH_UP_TIMEOUT_MS
    })
  }
  if (verdict?.state === 'failed') {
    return Object.freeze({ state: 'failed' as const, ...(typeof verdict.failureCode === 'string' ? { failureCode: verdict.failureCode } : {}) })
  }
  // A shape the contract does not name: treat it as a failed collection rather than a timeout.
  return Object.freeze({ state: 'failed' as const, failureCode: 'catch-up-verdict-invalid' })
}

async function readFreshness(
  reader: () => Promise<unknown>
): Promise<Extract<MarketCalendarFreshness, { state: 'available' }> | Readonly<{ state: 'unavailable' }>> {
  try {
    const value = await reader()
    return isMarketCalendarFreshness(value) && value.state === 'available'
      ? value
      : Object.freeze({ state: 'unavailable' as const })
  } catch {
    return Object.freeze({ state: 'unavailable' as const })
  }
}

/**
 * Flatten a source list into the two facts the reason codes need.
 *
 * `lastCollectedAt` is already the oldest latest-success across enabled feeds (computed once, in the
 * calendar runtime — never here). The attempt is the most recent one across feeds, because "the last
 * try failed" is about the try, not about which feed it happened to hit.
 */
function readingFrom(freshness: Extract<MarketCalendarFreshness, { state: 'available' }>): BriefingCalendarFreshnessReading {
  const attempt = latestAttempt(freshness.sources)
  return {
    state: 'available' as const,
    ...(freshness.lastCollectedAt ? { lastCollectedAt: freshness.lastCollectedAt } : {}),
    ...(attempt ? { lastAttemptAt: attempt.attemptedAt, lastAttemptFailed: attempt.state === 'failed' } : {})
  }
}

function latestAttempt(
  sources: readonly MarketCalendarCollectionFreshness[]
): Readonly<{ attemptedAt: string; state: 'succeeded' | 'failed' }> | undefined {
  let latest: Readonly<{ attemptedAt: string; state: 'succeeded' | 'failed' }> | undefined
  for (const source of sources) {
    const attempt = source.latestAttempt
    if (!attempt) continue
    if (!latest || Date.parse(attempt.attemptedAt) > Date.parse(latest.attemptedAt)) {
      latest = { attemptedAt: attempt.attemptedAt, state: attempt.state }
    }
  }
  return latest
}
