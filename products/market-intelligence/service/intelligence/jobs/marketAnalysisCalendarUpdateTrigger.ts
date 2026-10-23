/**
 * Turns a calendar refresh outcome into an analysis *evaluation* request.
 *
 * The economic calendar refreshes on its own schedule; the analysis is driven by intelligence
 * items, and calendar observations are not items, so this boundary is what tells the analysis
 * that the calendar moved at all.
 *
 * The decision this function makes is deliberately not "is this significant" — it cannot know:
 * a re-collection of identical values still stores rows, which is why "stored rows >= 1" spent
 * a model call every thirty minutes. Significance is decided once, by the gate, against the raw
 * route; this only asks it to look. The stored-row count is still reported as metadata.
 */
export const marketAnalysisCalendarUpdateTriggerPolicy = Object.freeze({
  version: 'marketAnalysisCalendarUpdateTriggerPolicy.v1',
  /** Same owner as the gate's routing table: this is a redirect, not a second significance rule. */
  triggerCondition: analysisTriggerSourcePolicy.calendarTriggerCondition,
  /** What the request means now: an evaluation was asked for, not a run that will happen. */
  requestDecision: 'requested' as const
})

import { analysisTriggerSourcePolicy } from '../analysis/analysisTriggerSourcePolicy'

export type CalendarRefreshRow = Readonly<{ state?: string; storedRows?: number }>

export type MarketAnalysisCalendarUpdateResult =
  | Readonly<{ decision: 'requested'; storedRows: number }>
  | Readonly<{ decision: 'skipped'; reasonCode: 'no-refresh-attempted' | 'producer-declined' }>

/**
 * Asks the gate to evaluate one refresh, and never throws: the calendar tick must succeed
 * whether or not the analysis accepts the request.
 */
export async function requestMarketAnalysisForCalendarUpdate(
  results: readonly CalendarRefreshRow[],
  deps: Readonly<{ requestRefresh: () => Promise<unknown> }>
): Promise<MarketAnalysisCalendarUpdateResult> {
  const storedRows = results.reduce((total, result) => total + (Number.isSafeInteger(result.storedRows) ? Number(result.storedRows) : 0), 0)
  // Nothing was attempted: there is nothing to evaluate.
  if (results.length === 0) return { decision: 'skipped', reasonCode: 'no-refresh-attempted' }
  try {
    await deps.requestRefresh()
    return { decision: 'requested', storedRows }
  } catch {
    // Includes the expected "analysis-already-available" refusal.
    return { decision: 'skipped', reasonCode: 'producer-declined' }
  }
}
