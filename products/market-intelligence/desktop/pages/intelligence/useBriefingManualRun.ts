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
export type BriefingManualRunOutcome = 'started' | 'cutoff-in-future' | 'cutoff-unreadable'

export function useBriefingManualRun(deps: Readonly<{
  timeZone: string
  regenerate: (input: Readonly<{ periodId: string; locale: DailyBriefingLocale; generation: { asOf: string; windowHours: DailyBriefingWindowHours } }>) => Promise<unknown>
  /** The clock this check runs against; injectable so the rule can be tested without waiting for 9am. */
  now?: () => Date
}>): (draft: BriefingManualRunDraft) => BriefingManualRunOutcome {
  return (draft) => {
    const now = deps.now?.() ?? new Date()
    const asOf = draft.cutoff === 'now' ? now.toISOString() : wallClockInstant(draft.cutoff, deps.timeZone, now)
    if (asOf === undefined) return 'cutoff-unreadable'
    // 未来时刻等于"生成一份还没发生的窗口"：那一刻根本没有数据，跑出来的是一份空报告，
    // 读者却以为它覆盖到了。拒绝并说明，比跑出一份假装完整的日报诚实。
    if (Date.parse(asOf) > now.getTime()) return 'cutoff-in-future'
    // Opaque and not derived from the time (A11.3); two presses are two issues, not one rewritten.
    const periodId = globalThis.crypto.randomUUID()
    void deps.regenerate({ periodId, locale: draft.language, generation: { asOf, windowHours: draft.windowHours as DailyBriefingWindowHours } })
    return 'started'
  }
}

function wallClockInstant(cutoff: string, timeZone: string, today: Date): string | undefined {
  const [hour, minute] = cutoff.split(':').map(Number)
  return instantForWallClock({
    timeZone, year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate(),
    hour: hour ?? 0, ...(minute === undefined ? {} : { minute })
  })?.toISOString()
}
