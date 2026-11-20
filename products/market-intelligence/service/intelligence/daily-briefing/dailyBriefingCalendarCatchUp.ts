import {
  isMarketCalendarFreshness,
  isMarketCalendarRefreshNowResult,
  type MarketCalendarCollectionFreshness,
  type MarketCalendarFreshness,
  type MarketCalendarWriteFailureView
} from '../../../contracts/macro/marketCalendarQueryContracts'
import { calendarFeedRegistry } from '../macro-calendar/calendarFeedRegistry'
import { sourceJobIds } from '../application/sourceJobRegistration'
import { BRIEFING_CALENDAR_STALE_AFTER_MS } from './dailyBriefingMacroEmptyReason'
import { isCurrentWriteFailure } from '../macro-calendar/calendarStandardWriteLayer'

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
 * 补跑清单 = **此刻真的有作业在跑的那些市场侧 feed**。
 *
 * 判据只有一个：该 feed 的作业定义在 `jobRuntime.listSchedules()` 里（装配层把那份投影传进来）。
 * **不从注册表的 `collection` 或 `optIn` 推断**——那是「登记了什么 / 默认要不要开」，不是
 * 「此刻在采」。两个方向的错都会发生：把没注册的源算进来，`refreshNow` 会对着不存在的作业发命令；
 * 读者刚启用的源被静态标记挡掉，该补的没补。
 *
 * 其余两条过滤回答的是另一个问题：**该不该由日报去补**——市场侧（官方日程自己有排期）、
 * 不被别的 feed 覆盖（Narwhal 一次调用写三类，只有一条作业）。
 */
export function briefingCalendarCatchUpSourceIds(registeredDefinitionIds: ReadonlySet<string>): readonly string[] {
  return Object.values(calendarFeedRegistry)
    .filter(feed => feed.owner === 'market' && feed.coveredBy === undefined)
    .filter(feed => sourceJobIds({ sourceId: feed.feedId, kind: 'market-calendar', collection: feed.collection })
      .some(id => registeredDefinitionIds.has(id)))
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
  state: 'skipped' | 'no-registered-jobs' | 'collected' | 'unchanged' | 'failed' | 'timeout' | 'unknown'
  /** Only meaningful on `timeout`: how long we actually waited. */
  timeoutMs?: number
  /**
   * Only on `skipped`: 为什么没补。`already-caught-up-this-period` = 本期内已经补过一次（策略跳过，
   * 不是失败）；`write-failed` = 采到了但写不进库，再采一次也不会写进去（写入侧的问题）。
   */
  reasonCode?: 'already-caught-up-this-period' | 'write-failed'
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
  /** 写入侧的最近一次失败；契约里的可选键，缺席 = 没失败（或缺席即老数据）。 */
  writeFailure?: MarketCalendarWriteFailureView
  catchUp?: BriefingCalendarCatchUp
}>

export type BriefingCalendarCatchUpDeps = Readonly<{
  /** The read-only freshness port. Absent means this build never wired the calendar runtime. */
  readFreshness?: () => Promise<unknown>
  /** The one write command the brief may run. Absent means the same thing, for the trigger. */
  refreshNow?: (input: { sourceIds: readonly string[]; timeoutMs: number }) => Promise<unknown>
  /**
   * 运行时已注册的作业定义 id（`jobRuntime.listSchedules()` 的投影）。**「此刻在采」只认它**：
   * 登记表里的 `collection`/`optIn` 说的是「登记了什么、默认要不要开」，回答不了这个问题。
   * 缺席 = 这个 build 没接运行时投影，此时不发起补跑（不许退回按开关推断）。
   */
  registeredScheduleIds?: () => readonly string[]
  /**
   * 同一统计期内**最多补一次**（用户 2026-11-16，Chief 定）。这是「要不要发请求」的策略，
   * 不是采集结果：跳过既不算失败、也不算「补了但没变」。缺席 = 不限制（窄测试替身）。
   */
  catchUpBudget?: Readonly<{ alreadyAttempted: () => boolean; markAttempted: () => void }>
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
  // 采到了但没写进库（`#32`，用户 2026-11-19）：再发一次补采，采集会成功、写入仍会失败，白花一次。
  // 判断**只调写入层那一个函数**（比较对象是「最后一次成功写入」，不是「最后一次成功采集」）：
  // 字段缺失 / 失败早于最后一次成功 → 它返回 false，继续走老路，正常补采不会被挡。
  if (first.writeFailure !== undefined
    && isCurrentWriteFailure({ at: first.writeFailure.at, lastSuccessAt: first.writeFailure.lastSuccessAt })) {
    console.log(`[macro-calendar.catch-up] ${JSON.stringify({
      asOf: deps.dataAsOf,
      verdict: 'skipped',
      reasonCode: 'write-failed',
      firstErrorCode: first.writeFailure!.code
    })}`)
    return Object.freeze({
      ...readingFrom(first),
      catchUp: Object.freeze({ state: 'skipped' as const, reasonCode: 'write-failed' as const })
    })
  }
  // Stale but no command: the reading is still true, so report it and let the reason codes say
  // "stale". Nothing was attempted, and that is not a failure.
  if (!deps.refreshNow) return Object.freeze(readingFrom(first))

  if (!deps.registeredScheduleIds) return Object.freeze(readingFrom(first))
  const sourceIds = briefingCalendarCatchUpSourceIds(new Set(deps.registeredScheduleIds()))
  if (sourceIds.length === 0) return Object.freeze({ ...readingFrom(first), catchUp: Object.freeze({ state: 'no-registered-jobs' as const }) })
  // 本期内已经补过一次：这次直接跳过。不写失败态，也不产生「补采没成功」那句话——
  // 我们只是决定不再发请求，采集本身没有任何结果可报。
  if (deps.catchUpBudget?.alreadyAttempted()) {
    return Object.freeze({ ...readingFrom(first), catchUp: Object.freeze({ state: 'skipped' as const, reasonCode: 'already-caught-up-this-period' as const }) })
  }
  deps.catchUpBudget?.markAttempted()
  const catchUp = await runCatchUp(deps.refreshNow, sourceIds)
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
  refreshNow: NonNullable<BriefingCalendarCatchUpDeps['refreshNow']>,
  sourceIds: readonly string[]
): Promise<BriefingCalendarCatchUp> {
  let raw: unknown
  try {
    raw = await refreshNow({
      sourceIds,
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
    ...(freshness.writeFailure ? { writeFailure: freshness.writeFailure } : {}),
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
