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
 * The window is the UTC calendar day, matching the UTC instants stored everywhere else.
 */

export type AnalysisRunCounts = Readonly<{ hourRuns: number; dayRuns: number; eventRunsToday: number; scheduledRunsToday: number }>

export type RunCounterLedgerRow = Readonly<{ triggerKey: string; reasonCode: string; decision: string; createdAt: string }>

export type RunCounterRepository = Readonly<{
  listEventGroups?: () => readonly Readonly<{ id: string }>[]
  listTriggerLedger?: (eventGroupId: string) => readonly RunCounterLedgerRow[]
}>

export const analysisRunCounterPolicy = Object.freeze({
  version: 'marketAnalysisRunCounterPolicy.v1',
  restartReasonPrefix: 'restart-'
})

function isCompensation(row: RunCounterLedgerRow): boolean {
  return row.reasonCode.startsWith(analysisRunCounterPolicy.restartReasonPrefix)
}

function isDelivered(row: RunCounterLedgerRow): boolean {
  return row.decision === 'queued' && !isCompensation(row)
}

function ledgerOf(repository: RunCounterRepository): readonly RunCounterLedgerRow[] {
  const groups = repository.listEventGroups?.() ?? []
  return groups.flatMap(group => [...(repository.listTriggerLedger?.(group.id) ?? [])])
}

export function countAnalysisRuns(repository: RunCounterRepository, now: string): AnalysisRunCounts {
  const nowMs = Date.parse(now)
  const day = now.slice(0, 10)
  const rows = ledgerOf(repository).filter(isDelivered).filter(row => row.createdAt.slice(0, 10) === day)
  // The scheduled line is the session slots; every other automatic delivery is an event run.
  const isScheduled = (row: RunCounterLedgerRow) => isScheduledSlotTriggerKey(row.triggerKey)
  return {
    hourRuns: rows.filter(row => nowMs - Date.parse(row.createdAt) < 60 * 60 * 1_000).length,
    dayRuns: rows.length,
    eventRunsToday: rows.filter(row => !isScheduled(row)).length,
    scheduledRunsToday: rows.filter(isScheduled).length
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
