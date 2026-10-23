import { isMarketAnalysisCanonicalUtc } from '../../../contracts/marketAnalysisContracts'
import { isScheduledSlotTriggerKey } from './analysisSchedulePolicy'
import { isGateExempt } from './analysisTriggerSourcePolicy'

/**
 * The analysis budget: how often automatic analysis may spend a model call.
 *
 * One owner for every time and quota number, because the previous arrangement declared
 * `maximumHourlyTriggers: 12` / `maximumDailyTriggers: 48` in `analysisTriggerPolicy` while
 * its only caller passed `hourTriggerCount: 0` / `dayTriggerCount: 0` — a budget that could
 * never fire. `analysisTriggerPolicy` now references these values instead of owning copies.
 *
 * The counts are inputs (produced by `analysisRunCounter`, which owns the window); this
 * policy only decides. `reasonCode` is non-null exactly when the decision is `skipped`, so a
 * caller cannot accidentally record a limit as the reason a run was allowed.
 */

export const analysisBudgetPolicy = Object.freeze({
  version: 'marketAnalysisBudgetPolicy.v2',
  /** Coalescing window for data-driven triggers; also the item path's per-phase cooldown. */
  minimumIntervalMs: 30 * 60 * 1_000,
  maximumHourlyRuns: 3,
  maximumDailyRuns: 12,
  /**
   * Reserved for the three session slots — one per open. The other lines may not touch it.
   *
   * Three, not the two the staleness floor reserved: the slots are the guarantee the reader asked
   * for ("fixed 8/16/24 o'clock"), and a reserve smaller than the schedule makes the third open
   * unsatisfiable by construction.
   */
  reservedScheduledRunsPerDay: 3,
  /**
   * The event line's own allowance: the daily total minus the slots' reserve, because the reserve
   * belongs to the opens. Three slots a day is one more than the floor reserved, so the data-driven
   * line gives up one of its ten — the same total, spent the way the reader asked for it.
   */
  eventRunsPerDayAllowance: 9,
  dayWindow: 'utc-calendar-day' as const,
  reasonCodes: Object.freeze({
    invalidInput: 'invalid-budget-input',
    hourly: 'hour-budget-exhausted',
    daily: 'day-budget-exhausted',
    scheduleReserve: 'schedule-reserve-exhausted',
    interval: 'interval-active'
  })
})

export type BudgetDecision = Readonly<{ decision: 'queued' | 'skipped'; reasonCode: string | null }>

export type AnalysisBudgetInput = Readonly<{
  triggerKey: string
  now: string
  lastAutoRunAt: string | null
  hourRuns: number
  dayRuns: number
  eventRunsToday: number
  /** Deliveries inside the reserved session-slot line (`schedule.*`). */
  scheduledRunsToday: number
}>

export function decideBudget(input: AnalysisBudgetInput): BudgetDecision {
  const skip = (reasonCode: string): BudgetDecision => ({ decision: 'skipped', reasonCode })
  const queued: BudgetDecision = { decision: 'queued', reasonCode: null }
  const counts = [input.hourRuns, input.dayRuns, input.eventRunsToday, input.scheduledRunsToday]
  const validInstant = (value: string | null) => value === null || (isMarketAnalysisCanonicalUtc(value) && Number.isFinite(Date.parse(value)))
  // Fail closed: a caller that cannot state its counts gets no permission to spend.
  if (!isMarketAnalysisCanonicalUtc(input.now) || !Number.isFinite(Date.parse(input.now)) ||
    !validInstant(input.lastAutoRunAt) || counts.some(count => !Number.isSafeInteger(count) || count < 0)) {
    return skip(analysisBudgetPolicy.reasonCodes.invalidInput)
  }
  // A human asked for this run: no significance, interval or budget limit applies.
  if (isGateExempt(input.triggerKey)) return queued
  // Session slots are decided *before* the daily total, unlike every other automatic line. That
  // total is spent by data-driven runs, and a busy day would otherwise spend the three calls the
  // slots exist to reserve — the same eviction that emptied funding and sentiment from the fact
  // budget once a new domain's facts were added. Their own reserve is the only limit they obey.
  if (isScheduledSlotTriggerKey(input.triggerKey)) {
    return input.scheduledRunsToday >= analysisBudgetPolicy.reservedScheduledRunsPerDay
      ? skip(analysisBudgetPolicy.reasonCodes.scheduleReserve)
      : queued
  }
  // The daily total applies to every other automatic source, before any per-line allowance.
  if (input.dayRuns >= analysisBudgetPolicy.maximumDailyRuns) return skip(analysisBudgetPolicy.reasonCodes.daily)
  if (input.eventRunsToday >= analysisBudgetPolicy.eventRunsPerDayAllowance) return skip(analysisBudgetPolicy.reasonCodes.daily)
  if (input.hourRuns >= analysisBudgetPolicy.maximumHourlyRuns) return skip(analysisBudgetPolicy.reasonCodes.hourly)
  if (input.lastAutoRunAt !== null && Date.parse(input.now) - Date.parse(input.lastAutoRunAt) < analysisBudgetPolicy.minimumIntervalMs) {
    return skip(analysisBudgetPolicy.reasonCodes.interval)
  }
  return queued
}
