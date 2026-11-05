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
export function useBriefingManualRun(deps: Readonly<{
  timeZone: string
  regenerate: (input: Readonly<{ periodId: string; locale: DailyBriefingLocale; generation: { asOf: string; windowHours: DailyBriefingWindowHours } }>) => Promise<unknown>
}>): (draft: BriefingManualRunDraft) => void {
  return (draft) => {
    const asOf = draft.cutoff === 'now' ? new Date().toISOString() : wallClockInstant(draft.cutoff, deps.timeZone)
    if (asOf === undefined) return
    // Opaque and not derived from the time (A11.3); two presses are two issues, not one rewritten.
    const periodId = globalThis.crypto.randomUUID()
    void deps.regenerate({ periodId, locale: draft.language, generation: { asOf, windowHours: draft.windowHours as DailyBriefingWindowHours } })
  }
}

function wallClockInstant(cutoff: string, timeZone: string): string | undefined {
  const [hour, minute] = cutoff.split(':').map(Number)
  const today = new Date()
  return instantForWallClock({
    timeZone, year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate(),
    hour: hour ?? 0, ...(minute === undefined ? {} : { minute })
  })?.toISOString()
}
