import {
  isMarketCalendarFreshness,
  isMarketCalendarRefreshNowResult,
  type MarketCalendarCollectionFreshness,
  type MarketCalendarFreshness
} from '../../../contracts/macro/marketCalendarQueryContracts'
import { calendarFeedRegistry } from '../macro-calendar/calendarFeedRegistry'
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

/**
 * The whole budget for one catch-up; the feeds share it, they do not each get one.
 *
 * **20 s, not the contract's 90 s default**（用户 2026-11-14）：补跑现在排的是作业，日报不该为了
 * 一次排不上的采集多等一分半；等多久与读者被告知的那句话必须同一个数（那句已不带数字，
 * 写死秒数会在下次调上限时变成假话）。契约接受 1–120 s，20 s 合法。
 */
export const BRIEFING_CALENDAR_CATCH_UP_TIMEOUT_MS = 20_000

/**
 * The calendar feeds the brief may catch up: **exactly the descriptors the live calendar service
 * exposes**, read from the policy rather than copied.
 *
 * `refreshNow` accepts nothing outside `marketCalendarPublicPolicy.descriptors` (anything else fails
 * closed as `input-invalid`), so a second copy of the three ids can only drift. When the calendar
 * switches provider the policy is the one place that changes, and this list follows.
 * `fed`/`bea` keep their own official schedule and are never caught up here.
 */
/**
 * 补跑清单 = **注册表里此刻真的在采的那些 feed**（`collection !== 'none'`）。
 *
 * 为什么不读契约里的 `collectionFeeds`：那个字段说的是「这份 provider 契约登记了哪条采集入口」，
 * 是**契约**；补跑要的是**运行时事实**——登记了但采集器还没接的（Narwhal 这一版）不能进清单，
 * 否则 `refreshNow` 只会回 `unavailable`。也不新增「谁在采」的字段：那是第二个答案，还得手动跟
 * 注册表同步，漏一次就是同一处红。采集器落地时只改注册表那一行，清单自动跟上。
 */
export function briefingCalendarCatchUpSourceIds(): readonly string[] {
  return Object.values(calendarFeedRegistry)
    // 判据三条一起：**市场侧**（`owner === 'market'`，官方日程那三条也是 `provider`，不能只看它）、
    // **真的在采**（`collection !== 'none'`）、**不是被别的 feed 覆盖的那两条**（`coveredBy` 为空）。
    // 今天正好一条：`macro-calendar-narwhal-economic-data`。
    /* `optIn !== true`：**读者启用后才采**的补充源不算「此刻在采」——没配置就没有作业，
       把它算进来会让 `refreshNow` 对着一个没注册的作业发命令。 */
    .filter(feed => feed.owner === 'market' && feed.collection !== 'none'
      && feed.coveredBy === undefined && feed.optIn !== true)
    .map(feed => feed.feedId)
}

export type BriefingCalendarCatchUp = Readonly<{
  /**
   * `unknown` is the fourth kind of "we do not know": the command was accepted but answered with a
   * shape the contract does not name (today's queue-triggered catch-up answers `completed`, which is
   * the old synchronous verdict). It is **not** a failed collection — nothing failed, we simply did
   * not learn the outcome — so the reader must not be told "the collection failed". The freshness
   * reading taken after the trigger is what decides the sentence.
   */
  state: 'skipped' | 'collected' | 'unchanged' | 'failed' | 'timeout' | 'unknown'
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
      sourceIds: briefingCalendarCatchUpSourceIds(),
      timeoutMs: BRIEFING_CALENDAR_CATCH_UP_TIMEOUT_MS
    })
  } catch (error) {
    // A command that threw is a failed collection, not a timeout: the two say different things.
    const message = error instanceof Error ? error.message : String(error)
    return Object.freeze({ state: 'failed' as const, failureCode: message.slice(0, 64) })
  }
  // 校验契约本身，不只校验 `state` 那个词：`{state:'collected'}` 少了 `sources`、`timeoutMs` 越界，
  // 都是「看着像、其实不是」。以前这里只读 state，半截形状会被当成真结果记下来。
  if (!isMarketCalendarRefreshNowResult(raw)) {
    // 命令被接受了、但没回答出契约里的结果。写成「采集失败」是给读者一句假话（像是源坏了），
    // 写成「超时」是凭空编一个时长。落「未知」，那句话交给补跑之后的读数决定。
    return Object.freeze({ state: 'unknown' as const, failureCode: 'catch-up-verdict-invalid' })
  }
  if (raw.state === 'collected' || raw.state === 'unchanged') {
    return Object.freeze({ state: raw.state })
  }
  if (raw.state === 'timeout') {
    return Object.freeze({ state: 'timeout' as const, timeoutMs: raw.timeoutMs })
  }
  return Object.freeze({ state: 'failed' as const, failureCode: raw.failureCode })
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
