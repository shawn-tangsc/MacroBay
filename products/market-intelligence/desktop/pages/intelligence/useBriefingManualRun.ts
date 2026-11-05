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
  regenerate: (input: Readonly<{ periodId: string; locale: DailyBriefingLocale; generation: { asOf: string; windowHours: DailyBriefingWindowHours } }>) => Promise<unknown>
  /** The clock this check runs against; injectable so the rule can be tested without waiting for 9am. */
  now?: () => Date
  /** 一次跑正在跑的时候不许再起一次：读者会以为按了没反应，于是反复按。 */
  running?: boolean
  findDuplicate?: (plan: Readonly<{ asOf: string; windowHours: number; language: DailyBriefingLocale }>) => BriefingManualDuplicate | undefined
}>): (draft: BriefingManualRunDraft) => BriefingManualRunResult {
  return (draft) => {
    if (deps.running === true) return { outcome: 'already-running' }
    const now = deps.now?.() ?? new Date()
    const asOf = draft.cutoff === 'now' ? now.toISOString() : wallClockInstant(draft.cutoff, deps.timeZone, now)
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
    void deps.regenerate({ periodId, locale: draft.language, generation: { asOf, windowHours: draft.windowHours as DailyBriefingWindowHours } })
    return { outcome: 'started' }
  }
}

function wallClockInstant(cutoff: string, timeZone: string, today: Date): string | undefined {
  const [hour, minute] = cutoff.split(':').map(Number)
  return instantForWallClock({
    timeZone, year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate(),
    hour: hour ?? 0, ...(minute === undefined ? {} : { minute })
  })?.toISOString()
}
