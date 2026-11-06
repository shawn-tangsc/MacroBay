import { analysisSchedulePolicy, triggerKeyForSlot } from '../analysis/analysisSchedulePolicy'
import type { SessionSlotInstant } from '../analysis/analysisSlotCoverage'

/**
 * What the tick asks about one open, answered from the rows that already exist.
 *
 * Three questions, three sources, no counters:
 * - delivered — a run that succeeded inside the open's coverage window;
 * - abandoned — attempted inside the window, nothing came of it, and the window has closed;
 * - attemptsToday — how many runs this trigger point produced today, which is also the retry count.
 *
 * Kept out of the runtime because each predicate is a small read with its own reasoning, and the
 * runtime file is a size baseline that may only shrink.
 */
export type SessionSlotCheckSources = Readonly<{
  now: () => string
  listRuns: () => readonly Readonly<{ triggerKey: string; status: string; queuedAt: string }>[]
  listEventGroups: () => readonly Readonly<{ id: string }>[]
  listTriggerLedger: (eventGroupId: string) => readonly Readonly<{ triggerKey: string; decision: string; createdAt: string }>[]
}>

export function createSessionSlotChecks(deps: SessionSlotCheckSources) {
  return {
    /**
     * An open counts as served only by a run requested for that open and succeeded inside its
     * delivery window — not by "some run succeeded lately", which silently merged two opens.
     */
    isDelivered(instant: SessionSlotInstant): boolean {
      const from = instant.atMs
      const to = from + analysisSchedulePolicy.coverageWindowMs
      const key = triggerKeyForSlot(instant.slot)
      return deps.listRuns().some(run => run.triggerKey === key && run.status === 'succeeded' &&
        Date.parse(run.queuedAt) >= from && Date.parse(run.queuedAt) < to)
    },
    /**
     * An open is abandoned when it was attempted inside its window, nothing came of it, and the
     * window has closed: without this a failed attempt would be re-requested on every tick for the
     * whole catch-up window. The open's ledger identity carries the local day (see
     * `sessionSlotChangeHash`), so a row at or after the open's instant is that open's attempt.
     */
    isAbandoned(instant: SessionSlotInstant): boolean {
      if (Date.parse(deps.now()) - instant.atMs <= analysisSchedulePolicy.coverageWindowMs) return false
      const key = triggerKeyForSlot(instant.slot)
      return deps.listEventGroups().flatMap(group => deps.listTriggerLedger(group.id))
        .some(row => row.triggerKey === key && row.decision === 'queued' && Date.parse(row.createdAt) >= instant.atMs)
    },
    /**
     * Attempts are counted from the run rows they wrote: a retry re-freezes, the as-of moves, and a
     * new run row exists. No second counter, and no "attempt row" that would break one run per call.
     */
    attemptsToday(instant: SessionSlotInstant): number {
      return deps.listRuns().filter(run =>
        run.triggerKey === triggerKeyForSlot(instant.slot) && Date.parse(run.queuedAt) >= instant.atMs).length
    }
  }
}
