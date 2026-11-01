import { analysisSchedulePolicy, type AnalysisSessionSlot } from './analysisSchedulePolicy'

/**
 * 去重键的日界：**固定 UTC**（计数语义）。
 *
 * 这里的日期只用来回答「同一次开盘是否已经处理过」，不是给人看的日期归属。
 * 跟机器或设置时区走会让同一次开盘在换时区前后算出两个键，于是重复分析或漏分析。
 * 读者侧的日期归属不在这里：它要跟设置时区，等有消费方时用 `slotCoverageDay` 那个名字实现，
 * 不要再用一个函数同时承担两种语义。
 */
export function slotDedupeDay(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (!Number.isFinite(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

/**
 * Which session slots are due, and which of those are still owed a delivery.
 *
 * Pure on purpose: the caller owns the ledger. `isDelivered` asks it whether a slot was already
 * spent, so the decision can be tested without a clock, a database or a model.
 */

export type SessionSlotInstant = Readonly<{
  slot: AnalysisSessionSlot
  /** The slot's instant as a UTC ISO string — the form every stored timestamp takes. */
  at: string
  atMs: number
}>

/**
 * Every slot instant inside the catch-up window at or before `now`, oldest first.
 *
 * Day arithmetic goes through the local `Date` constructor (year, month, day + offset, hour), never
 * through millisecond addition, so a DST transition moves a slot by an hour rather than shifting it
 * to the wrong local time. Only ever used with the window's own day count, which is why the loop
 * starts at the oldest offset and walks forward.
 */
export function slotInstantsWithin(now: Date, policy = analysisSchedulePolicy): readonly SessionSlotInstant[] {
  const nowMs = now.getTime()
  if (!Number.isFinite(nowMs)) return []
  const oldestOffset = -(Math.ceil(policy.catchUpWindowMs / 86_400_000) + 1)
  const instants: SessionSlotInstant[] = []
  for (let offset = oldestOffset; offset <= 0; offset += 1) {
    for (const slot of policy.slots) {
      // The local calendar day of `now`, shifted by whole days: the constructor normalizes month
      // and year overflow and applies the offset's DST rules for that hour.
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, slot.hour)
      const atMs = at.getTime()
      if (!Number.isFinite(atMs) || atMs > nowMs || atMs < nowMs - policy.catchUpWindowMs) continue
      instants.push({ slot: slot.slot, at: at.toISOString(), atMs })
    }
  }
  return instants.sort((left, right) => left.atMs - right.atMs)
}

export type DueSessionSlotsInput = Readonly<{
  /** Current instant as a UTC ISO string; an unreadable value yields no work (fail closed). */
  now: string
  /**
   * Whether the open already has a delivery: a run that *succeeded* inside its coverage window.
   * A ledger row is written before the model call, so a row alone would mark a failed attempt as
   * delivered and the open would never be retried.
   */
  isDelivered: (instant: SessionSlotInstant) => boolean
  /**
   * Whether the open tried and missed its chance: an attempt inside the window that never produced a
   * conclusion and whose window has now closed. Without this a failed attempt would be re-requested
   * on every tick for as long as the catch-up window lasts.
   */
  isAbandoned?: (instant: SessionSlotInstant) => boolean
  policy?: typeof analysisSchedulePolicy
}>

/**
 * The slots one tick should request: the **newest** unserved open, and nothing older.
 *
 * Catching up is not a backlog. The reader's rule: if the app opens just after the US open while the
 * European open was missed, only the US open is analysed — the European session's data has been
 * superseded, and running it would spend a model call describing a market that no longer exists.
 */
export function dueSessionSlots(input: DueSessionSlotsInput): readonly SessionSlotInstant[] {
  const policy = input.policy ?? analysisSchedulePolicy
  const now = new Date(input.now)
  if (!Number.isFinite(now.getTime())) return []
  // The single newest open decides everything: if it is served, or was attempted and missed, there
  // is nothing to catch up — an older open is history, not a queue the tick works through.
  const newest = slotInstantsWithin(now, policy).at(-1)
  if (!newest || policy.maxRunsPerTick <= 0) return []
  if (input.isDelivered(newest) || (input.isAbandoned?.(newest) ?? false)) return []
  return [newest]
}

/**
 * The most recent occurrence of one slot at or before `at` — the open a run is serving.
 *
 * A delayed catch-up serves an open hours after it happened, and the prompt has to say which open
 * that was, so the model does not read the current snapshot as the open's own state.
 */
export function slotInstantAtOrBefore(slot: AnalysisSessionSlot, at: Date, policy = analysisSchedulePolicy): string | null {
  if (!Number.isFinite(at.getTime())) return null
  const hour = policy.slots.find(entry => entry.slot === slot)?.hour
  if (hour === undefined) return null
  for (let offset = 0; offset >= -2; offset -= 1) {
    const candidate = new Date(at.getFullYear(), at.getMonth(), at.getDate() + offset, hour)
    if (Number.isFinite(candidate.getTime()) && candidate.getTime() <= at.getTime()) return candidate.toISOString()
  }
  return null
}
