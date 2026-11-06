import { instantForWallClock } from '@platform/time/timeZoneClock'

import type { DailyBriefingLocale, DailyBriefingWindowHours } from '../../../contracts/dailyBriefing'
import type { BriefingManualRunDraft } from './BriefingManualRunDialog'

/**
 * Turning the manual-run dialog into one run.
 *
 * The three inputs become an absolute cutoff: "now" is the press, a wall-clock hour is resolved in
 * the reader's zone by the platform clock (hand-built strings are an hour off around DST or land on
 * yesterday). The run carries its own opaque one-off period id — a manual run is a temporary issue,
 * never "run this period", so it cannot overwrite `default` or another period's language.
 */
export type BriefingManualRunOutcome = 'started' | 'cutoff-in-future' | 'cutoff-unreadable' | 'already-running' | 'duplicate'
/** 同一 (日期, 截止时刻, 窗口, 语言) 已经有一版时，找到它——替换要写在它身上，不是再插一行。 */
export type BriefingManualDuplicate = Readonly<{ periodId: string }>
/** 一次按下的结果：跑了 / 为什么没跑 / 或者撞上哪一版要读者决定。 */
export type BriefingManualRunResult = Readonly<{
  outcome: BriefingManualRunOutcome
  duplicate?: Readonly<{ periodId: string; asOf: string; windowHours: DailyBriefingWindowHours; language: DailyBriefingLocale }>
}>

export function useBriefingManualRun(deps: Readonly<{
  timeZone: string
  /**
   * 跑这一期。`date` 是读者选的那一天，只用于"生成中"那一行落在正确的日子上；
   * 服务端按截止时刻自己归档，不看它。
   */
  regenerate: (input: Readonly<{ periodId: string; locale: DailyBriefingLocale; date?: string; generation: { asOf: string; windowHours: DailyBriefingWindowHours } }>) => Promise<unknown>
  /** The clock this check runs against; injectable so the rule can be tested without waiting for 9am. */
  now?: () => Date
  /** 一次跑正在跑的时候不许再起一次：读者会以为按了没反应，于是反复按。 */
  running?: boolean
  findDuplicate?: (plan: Readonly<{ asOf: string; windowHours: number; language: DailyBriefingLocale }>) => BriefingManualDuplicate | undefined
}>): (draft: BriefingManualRunDraft) => BriefingManualRunResult {
  return (draft) => {
    if (deps.running === true) return { outcome: 'already-running' }
    const now = deps.now?.() ?? new Date()
    // 截止按**读者选的那一天**换算：'now' 就是按下这一刻，某个钟点则是"那一天的钟点"。
    // 以前用机器本地日期补年份月份，凌晨选 00:00 就落到第二天（`02` v2.129 G1）。
    const asOf = draft.cutoff === 'now' ? now.toISOString() : wallClockInstant(draft.cutoff, draft.date, deps.timeZone)
    if (asOf === undefined) return { outcome: 'cutoff-unreadable' }
    // 未来时刻等于"生成一份还没发生的窗口"：那一刻根本没有数据，跑出来的是一份空报告，
    // 读者却以为它覆盖到了。拒绝并说明，比跑出一份假装完整的日报诚实。
    if (Date.parse(asOf) > now.getTime()) return { outcome: 'cutoff-in-future' }
    const existing = deps.findDuplicate?.({ asOf, windowHours: draft.windowHours, language: draft.language })
    if (existing) {
      // 替换写在**已有那一版**身上：再插一行同 (日期, 截止, 窗口, 语言) 的版次，列表就出现两份说同一件事的。
      return { outcome: 'duplicate', duplicate: { periodId: existing.periodId, asOf, windowHours: draft.windowHours as DailyBriefingWindowHours, language: draft.language } }
    }
    // Opaque and not derived from the time (A11.3); two presses are two issues, not one rewritten.
    const periodId = globalThis.crypto.randomUUID()
    void deps.regenerate({ periodId, locale: draft.language, date: draft.date, generation: { asOf, windowHours: draft.windowHours as DailyBriefingWindowHours } })
    return { outcome: 'started' }
  }
}

/** `YYYY-MM-DD` 加一个墙钟小时 → 绝对时刻；日期或时刻读不懂时返回 `undefined`（页面据此拒绝）。 */
function wallClockInstant(cutoff: string, date: string, timeZone: string): string | undefined {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = cutoff.split(':').map(Number)
  if (year === undefined || month === undefined || day === undefined || hour === undefined) return undefined
  if (![year, month, day, hour].every((value) => Number.isFinite(value))) return undefined
  return instantForWallClock({
    timeZone, year, month, day, hour, ...(minute === undefined || !Number.isFinite(minute) ? {} : { minute })
  })?.toISOString()
}
