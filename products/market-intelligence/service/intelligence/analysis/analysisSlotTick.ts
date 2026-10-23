import { analysisSchedulePolicy, type AnalysisSessionSlot } from './analysisSchedulePolicy'
import { dueSessionSlots, type SessionSlotInstant } from './analysisSlotCoverage'

/**
 * The session slot tick: the clock that keeps a conclusion at every open.
 *
 * This replaces the 8-hour staleness floor. The floor used the same 15-minute job but decided on
 * "eight hours since the last success", which drifts with usage and has nothing to do with when a
 * session opens. The tick now asks a different question — "which opens inside the catch-up window
 * have not been served?" — which covers both cases with one mechanism: the app being open across
 * 16:00 is the online case, and the app having been closed all morning is the catch-up case.
 *
 * The anchor precondition is unchanged from the floor: analysis hangs off an event group created
 * from an intelligence item, so with no item at all there is no group to analyse and no group to
 * record against. That case is reported as an outcome and logged, never as a silent skip.
 */

export const analysisSlotTickPolicy = Object.freeze({
  version: 'marketAnalysisSlotTickPolicy.v1',
  intervalMs: analysisSchedulePolicy.tickIntervalMs
})

/** The tick's only precondition: there is something to analyse at all. */
export function hasSlotAnchor(items: readonly unknown[]): boolean {
  return items.length > 0
}

export type SlotTickOutcome = 'requested' | 'not-due' | 'no-anchor'

export type SlotTickResult = Readonly<{
  outcome: SlotTickOutcome
  /** The opens this tick spent a model call on, oldest first. */
  requested: readonly AnalysisSessionSlot[]
  /** Opens that were due but could not be requested; the next tick inside the window retries. */
  deferred: readonly AnalysisSessionSlot[]
}>

export type SlotTickDependencies = Readonly<{
  now: () => string
  /** Whether the open already has a delivery: a run that succeeded inside its coverage window. */
  isDelivered: (instant: SessionSlotInstant) => boolean
  /** Whether the open tried inside its window, failed, and ran out of window: it is not retried. */
  isAbandoned?: (instant: SessionSlotInstant) => boolean
  hasEligibleAnchor: () => boolean
  /** Goes through the ordinary request path, so the gate's budget, interval and ledger apply. */
  requestSlotAnalysis: (instant: SessionSlotInstant) => Promise<void>
  log: (message: string, metadata?: Readonly<Record<string, unknown>>) => Promise<void> | void
}>

export function createAnalysisSlotTick(dependencies: SlotTickDependencies) {
  return {
    async run(): Promise<SlotTickResult> {
      const now = dependencies.now()
      const due = dueSessionSlots({ now, isDelivered: dependencies.isDelivered, isAbandoned: dependencies.isAbandoned })
      if (due.length === 0) return { outcome: 'not-due', requested: [], deferred: [] }
      if (!dependencies.hasEligibleAnchor()) {
        await dependencies.log('Market analysis session slot skipped: no eligible intelligence anchor.', { now, due: due.map(instant => instant.slot) })
        return { outcome: 'no-anchor', requested: [], deferred: due.map(instant => instant.slot) }
      }
      const requested: AnalysisSessionSlot[] = []
      const deferred: AnalysisSessionSlot[] = []
      // Oldest first, one at a time. A refusal (a run already in flight, the reserve spent) leaves
      // no ledger row, so the open stays owed and the next tick retries it inside its window.
      for (const instant of due) {
        try {
          await dependencies.requestSlotAnalysis(instant)
          requested.push(instant.slot)
        } catch {
          deferred.push(instant.slot)
        }
      }
      return {
        outcome: requested.length > 0 ? 'requested' : 'not-due',
        requested,
        deferred
      }
    }
  }
}
