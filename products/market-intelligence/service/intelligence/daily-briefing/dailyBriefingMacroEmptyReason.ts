import type { MarketCalendarWriteFailureView } from '../../../contracts/macro/marketCalendarWriteFailureContract'
import { isCurrentWriteFailure } from '../macro-calendar/calendarStandardWriteLayer'

/**
 * 宏观事件那一栏「为什么是空的」（`02` `A0.8` / `A0.10`）。
 *
 * 五档互斥，前三个都归「读不到」，只有最后一档才是「确实没有」：
 *
 * 1. `calendar-not-collected` —— 从来没有成功采集过；
 * 2. `calendar-collect-failed` —— 最近一次采集失败**晚于**最后一次成功（"失败后又有成功"要判对）；
 * 3. `calendar-write-failed` —— **采到了，但没写进库**（`writeFailure` 晚于最后一次成功写入）：
 *    来源是好的，不能建议查网络与凭据，也不该为它再发一次补采（用户 2026-11-19 / `#32`）；
 * 4. `calendar-stale` —— 最后一次成功距**这一版实际采用的数据截止 `dataAsOf`** 超过两小时；
 * 5. `past-24h-no-high-impact-release` —— 数据是新的，窗口内确实没有高影响发布。
 *
 * **基准是 `dataAsOf`，不是期次截止**：补跑时两者不同，用截止去算会让那一版"一边显示事件、
 * 一边说读不到"。判据看的是补采并等规范化完成之后的状态，所以这个函数只回答"按这两份读数
 * 该怎么写"，什么时候补采、等多久由调用方决定。
 */
export type BriefingMacroEmptyReason =
  | 'calendar-not-collected'
  | 'calendar-collect-failed'
  | 'calendar-write-failed'
  | 'calendar-stale'
  | 'past-24h-no-high-impact-release'

/** 最后一次成功采集距 `dataAsOf` 超过这么久，就算过期。 */
export const BRIEFING_CALENDAR_STALE_AFTER_MS = 2 * 60 * 60 * 1_000

export function briefingMacroEmptyReason(input: Readonly<{
  /** 日历读取本身的可用性：读失败时**必须**落「读不到」，不许折叠成「没有」。 */
  state: 'available' | 'unavailable' | 'source-disabled'
  lastCollectedAt?: string
  lastAttemptAt?: string
  lastAttemptFailed?: boolean
  /**
   * 写入侧的最近一次失败（契约里的可选键，形状已校验）。**判据只调写入层那一个函数**：
   * 失败晚于最后一次成功写入才算「这次写失败了」；早于它说明后来写成功了，那一档不许再冒出来。
   * 这里不比较时间——比法只有一处，配置线与用例都读同一个函数。
   */
  writeFailure?: MarketCalendarWriteFailureView
  /** 这一版实际采用的数据截止（补跑时是运行时刻）。 */
  dataAsOf: string
}>): BriefingMacroEmptyReason | 'calendar-unavailable' | 'calendar-source-disabled' {
  if (input.state === 'source-disabled') return 'calendar-source-disabled'
  if (input.state === 'unavailable') return 'calendar-unavailable'
  if (input.lastCollectedAt === undefined) return 'calendar-not-collected'
  const age = Date.parse(input.dataAsOf) - Date.parse(input.lastCollectedAt)
  // **读数新鲜时，窗口空就是空**（用户 2026-11-16）：别的源最近一次失败改不了这个事实。
  // 旧顺序把「跨所有源最近一次失败」放在最前，于是 BLS 那一路被拦，整栏就写成「日历采集失败」，
  // 还建议读者去改配置——第三次同族错误（空窗被写成故障）。
  if (Number.isFinite(age) && age <= BRIEFING_CALENDAR_STALE_AFTER_MS) return 'past-24h-no-high-impact-release'
  // 只有读数不新鲜时，才轮到「最近一次失败」或「过期」：
  // 失败晚于成功才算"最近一次失败"：只看"最近一次是不是失败"会把"失败后又有成功"判错。
  // 采到了但没写进库：**来源没问题**，句子和建议都必须指向写入侧（用户 2026-11-19 / `#32`）。
  // 放在「采集失败」之前：写入失败时采集往往是成功的，先判采集会把库的问题说成源的问题。
  if (input.writeFailure !== undefined
    && isCurrentWriteFailure({ at: input.writeFailure.at, lastSuccessAt: input.writeFailure.lastSuccessAt })) {
    return 'calendar-write-failed'
  }
  const failedAfterSuccess = input.lastAttemptFailed === true && input.lastAttemptAt !== undefined
    && Date.parse(input.lastAttemptAt) > Date.parse(input.lastCollectedAt)
  if (failedAfterSuccess) return 'calendar-collect-failed'
  return 'calendar-stale'
}
