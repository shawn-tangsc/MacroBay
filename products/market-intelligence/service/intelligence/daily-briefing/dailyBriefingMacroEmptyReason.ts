/**
 * 宏观事件那一栏「为什么是空的」（`02` `A0.8` / `A0.10`）。
 *
 * 四档互斥，前三个都归「读不到」，只有第四档才是「确实没有」：
 *
 * 1. `calendar-not-collected` —— 从来没有成功采集过；
 * 2. `calendar-collect-failed` —— 最近一次采集失败**晚于**最后一次成功（"失败后又有成功"要判对）；
 * 3. `calendar-stale` —— 最后一次成功距**这一版实际采用的数据截止 `dataAsOf`** 超过两小时；
 * 4. `past-24h-no-high-impact-release` —— 数据是新的，窗口内确实没有高影响发布。
 *
 * **基准是 `dataAsOf`，不是期次截止**：补跑时两者不同，用截止去算会让那一版"一边显示事件、
 * 一边说读不到"。判据看的是补采并等规范化完成之后的状态，所以这个函数只回答"按这两份读数
 * 该怎么写"，什么时候补采、等多久由调用方决定。
 */
export type BriefingMacroEmptyReason =
  | 'calendar-not-collected'
  | 'calendar-collect-failed'
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
  /** 这一版实际采用的数据截止（补跑时是运行时刻）。 */
  dataAsOf: string
}>): BriefingMacroEmptyReason | 'calendar-unavailable' | 'calendar-source-disabled' {
  if (input.state === 'source-disabled') return 'calendar-source-disabled'
  if (input.state === 'unavailable') return 'calendar-unavailable'
  if (input.lastCollectedAt === undefined) return 'calendar-not-collected'
  // 失败晚于成功才算"最近一次失败"：只看"最近一次是不是失败"会把"失败后又有成功"判错。
  const failedAfterSuccess = input.lastAttemptFailed === true && input.lastAttemptAt !== undefined
    && Date.parse(input.lastAttemptAt) > Date.parse(input.lastCollectedAt)
  if (failedAfterSuccess) return 'calendar-collect-failed'
  const age = Date.parse(input.dataAsOf) - Date.parse(input.lastCollectedAt)
  if (!Number.isFinite(age) || age > BRIEFING_CALENDAR_STALE_AFTER_MS) return 'calendar-stale'
  return 'past-24h-no-high-impact-release'
}
