import { calendarDisplayDate } from '../../features/macro/economic-calendar/economicCalendarDayModel'
import type { MarketAnalysisTimelineEntry } from '../../shared/ipc/marketAnalysisTimelineClient'

/**
 * One published analysis, as the runs bar lists it: when it happened and why it was started.
 *
 * `reasonCode` is null when the run carries no recorded decision. That is a third state, not an
 * empty one: the analysis ran, the ledger simply has no reason on it. The bar says "原因没记录"
 * for those rows and must never fold them into "哪些没分析" — that list is about runs that were
 * refused, and a run that happened is not a refusal.
 */
export type AnalysisRunRecord = Readonly<{
  id: string
  at: string
  reasonCode: string | null
}>

/**
 * The bar speaks about the reader's own day only ("今天"), while the ledger keeps 15 days and the
 * timeline pages backwards. One display day, one boundary — the reader's time zone, never UTC.
 */
export const analysisRunBarPolicy = Object.freeze({
  /** One screen of records. The timeline's first page is smaller than this in practice. */
  maxRows: 20
})

/**
 * The runs the bar lists: the reader's display day only, newest first.
 *
 * A run without a decision is still returned (with `reasonCode: null`) rather than dropped:
 * dropping it would make the bar's list shorter than what actually ran, and the reader uses this
 * list to check whether work was skipped.
 *
 * Skipped signals are a different projection (the trace read, S2) and are never mixed in here:
 * this list counts runs, that one counts signals — using one number for both is how the bar would
 * claim "1 row" while four signals happened.
 */
export function analysisRunRecords(
  entries: readonly MarketAnalysisTimelineEntry[],
  nowIso: string,
  timeZone: string,
  policy: typeof analysisRunBarPolicy = analysisRunBarPolicy
): readonly AnalysisRunRecord[] {
  const today = calendarDisplayDate(nowIso, timeZone)
  return entries
    // `system` rows describe the workspace, not an analysis; they were never a run.
    .filter(entry => entry.kind !== 'system')
    .filter(entry => calendarDisplayDate(entry.occurredAt, timeZone) === today)
    .map(entry => ({
      id: entry.id,
      at: entry.occurredAt,
      reasonCode: entry.triggerStatus?.reasonCode ?? null
    }))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, policy.maxRows)
}
