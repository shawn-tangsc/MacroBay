import { analysisBudgetPolicy } from './analysisBudgetPolicy'
import { isScheduledSlotTriggerKey } from './analysisSchedulePolicy'
import { analysisTriggerSourcePolicy } from './analysisTriggerSourcePolicy'

/**
 * Counts the automatic runs the budget is spent on.
 *
 * Counted from trigger-ledger decisions rather than from runs, because a decision row is what
 * "we spent a model call for this" means and its `created_at` is immutable. Restart
 * compensation is excluded: `recover()` re-enqueues runs for work that was already budgeted,
 * and letting those consume the quota would let a restart eat the session slots' reserve.
 * The exclusion keys off the reason-code prefix, which survives the ledger's upsert because
 * every `recover()` decision is `restart-*`.
 *
 * A row that says `queued` therefore means "this attempt was finally allowed": the trigger line
 * writes its row before the significance gate sees it, and a refusal later flips that same row to
 * `skipped` (by row id). A second skipped row would leave the attempt counted, which is how a day
 * could be charged for calls that never happened.
 *
 * The window is the UTC calendar day, matching the UTC instants stored everywhere else. The
 * per-hour event count is the same filter over the trailing hour, so the day and the hour can only
 * ever disagree about the window, never about which line a delivery belongs to.
 */

export type AnalysisRunCounts = Readonly<{
  hourRuns: number
  dayRuns: number
  eventRunsToday: number
  scheduledRunsToday: number
  /**
   * The exact mirror of `eventRunsToday` over the trailing hour. The hourly quota reads this one:
   * the slot line already reserves three calls a day, and charging it to the hourly quota too let a
   * single open close an hour in which the event line had not reached its limit.
   */
  eventRunsThisHour: number
}>

export type RunCounterLedgerRow = Readonly<{ triggerKey: string; reasonCode: string; decision: string; createdAt: string }>

export type RunCounterRepository = Readonly<{
  listEventGroups?: () => readonly Readonly<{ id: string }>[]
  listTriggerLedger?: (eventGroupId: string) => readonly RunCounterLedgerRow[]
}>

export const analysisRunCounterPolicy = Object.freeze({
  version: 'marketAnalysisRunCounterPolicy.v2',
  restartReasonPrefix: 'restart-'
})

function isCompensation(row: RunCounterLedgerRow): boolean {
  return row.reasonCode.startsWith(analysisRunCounterPolicy.restartReasonPrefix)
}

function isDelivered(row: RunCounterLedgerRow): boolean {
  return row.decision === 'queued' && !isCompensation(row)
}

/** The one place that decides whether a delivery belongs to the session-slot line. */
function isScheduledRun(row: RunCounterLedgerRow): boolean {
  return isScheduledSlotTriggerKey(row.triggerKey)
}

function ledgerOf(repository: RunCounterRepository): readonly RunCounterLedgerRow[] {
  const groups = repository.listEventGroups?.() ?? []
  return groups.flatMap(group => [...(repository.listTriggerLedger?.(group.id) ?? [])])
}

export function countAnalysisRuns(repository: RunCounterRepository, now: string): AnalysisRunCounts {
  const nowMs = Date.parse(now)
  const day = now.slice(0, 10)
  const rows = ledgerOf(repository).filter(isDelivered).filter(row => row.createdAt.slice(0, 10) === day)
  const hourRows = rows.filter(row => nowMs - Date.parse(row.createdAt) < 60 * 60 * 1_000)
  return {
    hourRuns: hourRows.length,
    dayRuns: rows.length,
    eventRunsToday: rows.filter(row => !isScheduledRun(row)).length,
    scheduledRunsToday: rows.filter(isScheduledRun).length,
    eventRunsThisHour: hourRows.filter(row => !isScheduledRun(row)).length
  }
}

/** The most recent delivered automatic run in one group: the coalescing window's baseline. */
export function lastAutoRunAt(repository: RunCounterRepository, eventGroupId: string, now: string): string | null {
  const rows = (repository.listTriggerLedger?.(eventGroupId) ?? [])
    .filter(isDelivered)
    .filter(row => row.createdAt <= now)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  return rows[0]?.createdAt ?? null
}

/** Exposed so the item path can share the same trigger-key vocabulary. */
export const analysisRunTriggerKeys = analysisTriggerSourcePolicy.gateEligibleTriggerKeys
