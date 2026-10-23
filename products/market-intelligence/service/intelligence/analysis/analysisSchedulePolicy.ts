/**
 * When automatic analysis runs: three fixed session slots, not a staleness floor.
 *
 * The floor was clock-only and untethered from anything a trader cares about: it fired eight hours
 * after the last success, so the hour drifted with usage and a reader opening the app at 09:00
 * could be told "not due yet" while the Asian open had already passed. The three slots are the
 * opens of the sessions the market actually trades in (local wall-clock 08:00 / 16:00 / 24:00),
 * and the tick that serves them also catches up whatever was missed while the app was closed.
 *
 * Local time on purpose: the reader asked for 8/16/24 o'clock, and the app shows their machine's
 * offset. Slot instants are built with the local `Date` constructor so DST is the runtime's
 * problem, and compared as UTC instants.
 */

export const analysisSessionSlots = Object.freeze(['asia', 'europe', 'us'] as const)
export type AnalysisSessionSlot = typeof analysisSessionSlots[number]

export const analysisSchedulePolicy = Object.freeze({
  version: 'marketAnalysisSchedulePolicy.v1',
  /** How often the tick asks whether a slot is due. Replaces the floor's 15-minute check. */
  tickIntervalMs: 15 * 60 * 1_000,
  /**
   * The three opens, as local wall-clock hours. `us` is 24:00 — the day boundary, which is hour 0
   * of the day it closes.
   */
  slots: Object.freeze([
    Object.freeze({ slot: 'asia' as AnalysisSessionSlot, hour: 8 }),
    Object.freeze({ slot: 'europe' as AnalysisSessionSlot, hour: 16 }),
    Object.freeze({ slot: 'us' as AnalysisSessionSlot, hour: 0 })
  ]),
  /**
   * A slot counts as delivered when a `queued` ledger row for its trigger key lands inside this
   * window. It is also the retry window: a slot whose request failed has no ledger row, so the
   * next tick inside the window tries again.
   */
  coverageWindowMs: 2 * 60 * 60 * 1_000,
  /**
   * How far back a missed open is still worth running on startup. Beyond this the gap is history,
   * not a slot: a machine that was off for a week must not run twenty model calls on open.
   */
  catchUpWindowMs: 24 * 60 * 60 * 1_000,
  /**
   * One open per tick, and it is the *newest* unserved one. Catching up is not a backlog: if the app
   * opens just after the US open, the reader wants the US session analysed, not yesterday's European
   * session and then the US one. Older opens are history — the data they would have described has
   * been superseded.
   */
  maxRunsPerTick: 1,
  triggerKeyPrefix: 'schedule.' as const
})

/** The trigger key the ledger records for one slot's delivery. */
export function triggerKeyForSlot(slot: AnalysisSessionSlot): string {
  return `${analysisSchedulePolicy.triggerKeyPrefix}${slot}.open`
}

/** The slot a trigger key belongs to, or null when the key is not a slot key. */
export function slotForTriggerKey(triggerKey: string): AnalysisSessionSlot | null {
  const match = new RegExp(`^${analysisSchedulePolicy.triggerKeyPrefix}([a-z]+)\\.open$`).exec(triggerKey)
  const slot = match?.[1]
  return slot && (analysisSessionSlots as readonly string[]).includes(slot) ? slot as AnalysisSessionSlot : null
}

export function isScheduledSlotTriggerKey(triggerKey: string): boolean {
  return slotForTriggerKey(triggerKey) !== null
}
