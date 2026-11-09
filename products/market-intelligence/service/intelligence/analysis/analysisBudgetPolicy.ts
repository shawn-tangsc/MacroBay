import { isMarketAnalysisCanonicalUtc } from '../../../contracts/marketAnalysisContracts'
import { isScheduledSlotTriggerKey } from './analysisSchedulePolicy'
import { analysisRunLineOf, isGateExempt } from './analysisTriggerSourcePolicy'

/**
 * The analysis budget: how often automatic analysis may spend a model call.
 *
 * One owner for every quota number, and now one quota per line. Until this version the calendar
 * line's nine calls were counted against the same bucket the item line spent, so a busy event day
 * quietly ate the calendar's whole allowance; measured over seven days the calendar line was
 * refused 56 times for a total it never got to use. Each line now reads its own counts
 * (`analysisRunCounter` produces them from one line classifier), and the global daily number is
 * only a backstop.
 *
 * The counts are inputs; this policy only decides. `reasonCode` is non-null exactly when the
 * decision is `skipped`, so a caller cannot accidentally record a limit as the reason a run was
 * allowed.
 */

export const analysisBudgetPolicy = Object.freeze({
  version: 'marketAnalysisBudgetPolicy.v3',
  /**
   * Coalescing window. Declared per line in `lineQuotas`: the calendar line obeys it, the item line
   * does not — the item path already carries its own 30-minute phase cooldown in
   * `analysisTriggerPolicy`, and stacking a second window on top would refuse attempts the old
   * arrangement allowed.
   */
  minimumIntervalMs: 30 * 60 * 1_000,
  /**
   * Backstop for the whole data-driven day: the sum of the two lines' daily quotas (48 + 9). It is
   * deliberately not smaller than any line, or a busy line would be charged the other's spend.
   */
  maximumDailyRuns: 60,
  /**
   * Global hourly gate, counted across every line including the reserved session slots.
   *
   * Per-line quotas decide who may spend; this decides whether the day may spend any more at all.
   * Without it, removing `analysisTriggerPolicy`'s combined guard would leave no ceiling above the
   * individual lines. The numbers are the ones approved with the per-line split (60 a day, 15 an
   * hour), not the old gate's 48/12.
   */
  maximumHourlyRuns: 15,
  /**
   * Reserved for the three session slots — one per open. The other lines may not touch it.
   *
   * Three, not the two the staleness floor reserved: the slots are the guarantee the reader asked
   * for ("fixed 8/16/24 o'clock"), and a reserve smaller than the schedule makes the third open
   * unsatisfiable by construction.
   */
  reservedScheduledRunsPerDay: 3,
  lineQuotas: Object.freeze({
    /**
     * The item line keeps the quotas `analysisTriggerPolicy` actually enforced (12 an hour, 48 a
     * day) so removing that gate is an equivalent migration, not a tightening.
     */
    event: Object.freeze({ daily: 48, hourly: 12, coalesce: false }),
    /** The calendar line's own nine a day, plus the three an hour it was previously denied. */
    calendar: Object.freeze({ daily: 9, hourly: 3, coalesce: true })
  }),
  dayWindow: 'utc-calendar-day' as const,
  reasonCodes: Object.freeze({
    invalidInput: 'invalid-budget-input',
    hourly: 'hour-budget-exhausted',
    daily: 'day-budget-exhausted',
    /**
     * 全局兜底日闸门单独一个码（同码两义要拆码）：它拒绝时读者的那条线可能还有余量，
     * 通知正文不能说成「这条线用完了」，否则读者一算就不平。
     */
    dailyGlobal: 'global-day-budget-exhausted',
    scheduleReserve: 'schedule-reserve-exhausted',
    interval: 'interval-active'
  })
})

/**
 * The numbers behind a refusal, in the same shape the reader sees them.
 *
 * The policy owns the quota numbers, so it also reports the pair that was actually hit: `used`
 * and `limit` of **that** gate (a line's daily quota, the global backstop, an hourly window).
 * Recomputing the pair at the call site would mean a second copy of the limits, and the two
 * copies would disagree exactly when the global gate is the one that refused.
 */
export type DailyQuota = Readonly<{ used: number; limit: number }>

export type BudgetDecision = Readonly<{
  decision: 'queued' | 'skipped'
  reasonCode: string | null
  /**
   * The day's pair behind a **daily** refusal — the only refusal that means 「今天的次数用完了」.
   * Absent on a queue and on hourly / interval / reserve refusals: those are not the day's quota,
   * and reporting them as one would tell the reader something false about how much is left.
   */
  dailyQuota?: DailyQuota
}>

export type AnalysisBudgetInput = Readonly<{
  triggerKey: string
  now: string
  lastAutoRunAt: string | null
  hourRuns: number
  dayRuns: number
  eventRunsToday: number
  eventRunsThisHour: number
  calendarRunsToday: number
  calendarRunsThisHour: number
  /** Deliveries inside the reserved session-slot line (`schedule.*`). */
  scheduledRunsToday: number
}>

export function decideBudget(input: AnalysisBudgetInput): BudgetDecision {
  const skip = (reasonCode: string, dailyQuota?: DailyQuota): BudgetDecision =>
    ({ decision: 'skipped', reasonCode, ...(dailyQuota === undefined ? {} : { dailyQuota }) })
  const queued: BudgetDecision = { decision: 'queued', reasonCode: null }
  const quotaOf = (used: number, limit: number): DailyQuota => Object.freeze({ used, limit })
  const counts = [
    input.hourRuns, input.dayRuns, input.eventRunsToday, input.eventRunsThisHour,
    input.calendarRunsToday, input.calendarRunsThisHour, input.scheduledRunsToday
  ]
  const validInstant = (value: string | null) => value === null || (isMarketAnalysisCanonicalUtc(value) && Number.isFinite(Date.parse(value)))
  // Fail closed: a caller that cannot state its counts gets no permission to spend.
  if (!isMarketAnalysisCanonicalUtc(input.now) || !Number.isFinite(Date.parse(input.now)) ||
    !validInstant(input.lastAutoRunAt) || counts.some(count => !Number.isSafeInteger(count) || count < 0)) {
    return skip(analysisBudgetPolicy.reasonCodes.invalidInput)
  }
  // A human asked for this run: no significance, interval or budget limit applies.
  if (isGateExempt(input.triggerKey)) return queued
  // Session slots are decided *before* every other line. That total is spent by data-driven runs,
  // and a busy day would otherwise spend the three calls the slots exist to reserve. Their own
  // reserve is the only limit they obey.
  if (isScheduledSlotTriggerKey(input.triggerKey)) {
    return input.scheduledRunsToday >= analysisBudgetPolicy.reservedScheduledRunsPerDay
      ? skip(analysisBudgetPolicy.reasonCodes.scheduleReserve)
      : queued
  }
  // Each data-driven line reads its own day and hour. A new key is the calendar line until it is
  // registered as an event: the default is the strict line, never the generous one.
  const line = analysisRunLineOf(input.triggerKey)
  const quota = line === 'event' ? analysisBudgetPolicy.lineQuotas.event : analysisBudgetPolicy.lineQuotas.calendar
  const runsToday = line === 'event' ? input.eventRunsToday : input.calendarRunsToday
  const runsThisHour = line === 'event' ? input.eventRunsThisHour : input.calendarRunsThisHour
  if (runsToday >= quota.daily) return skip(analysisBudgetPolicy.reasonCodes.daily, quotaOf(runsToday, quota.daily))
  if (runsThisHour >= quota.hourly) return skip(analysisBudgetPolicy.reasonCodes.hourly)
  if (quota.coalesce && input.lastAutoRunAt !== null && Date.parse(input.now) - Date.parse(input.lastAutoRunAt) < analysisBudgetPolicy.minimumIntervalMs) {
    return skip(analysisBudgetPolicy.reasonCodes.interval)
  }
  // Global gates last: a data-driven line inside its own quota is still refused once the whole day
  // or hour is spent. `dayRuns`/`hourRuns` count every delivered run including the reserved slots,
  // which is what the combined guard these replace used to count. The slots themselves are exempt:
  // they are already capped at three a day, and 48 + 9 + 3 is exactly the 60 this gate enforces.
  if (input.hourRuns >= analysisBudgetPolicy.maximumHourlyRuns) return skip(analysisBudgetPolicy.reasonCodes.hourly)
  if (input.dayRuns >= analysisBudgetPolicy.maximumDailyRuns) return skip(analysisBudgetPolicy.reasonCodes.dailyGlobal, quotaOf(input.dayRuns, analysisBudgetPolicy.maximumDailyRuns))
  return queued
}
