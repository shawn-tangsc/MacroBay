import { analysisTriggerSourcePolicy } from './analysisTriggerSourcePolicy'
import { analysisSchedulePolicy, slotForTriggerKey } from './analysisSchedulePolicy'
import { slotInstantAtOrBefore } from './analysisSlotCoverage'

/**
 * Projects the trigger decision that explains one timeline entry's run.
 *
 * This is how the panel answers "why did this analysis run — or not run". It returns tokens only:
 * the reason-code wording is product copy and lives in the renderer's i18n registry, because the
 * main process must not import renderer code.
 *
 * The attribution is per run, not per group. The projection used to hand every row the group's
 * newest explainable decision, so a row the reader produced by pressing 重新分析 showed the
 * staleness floor's wording: a repeated floor decision keeps its original `created_at` (the
 * ledger's dedupe key is group + trigger key + content hash), so the reader saw "结论已超过 8
 * 小时，保底刷新（前天 15:02 起）" under an analysis they had just asked for. Manual runs never
 * write a ledger row at all — the significance gate exempts them, because a human asking is not a
 * data question — so they could only ever be described by someone else's decision.
 *
 * The UI wording says "since <time>" rather than "at the last check" for the same dedupe reason:
 * an unchanged condition keeps the time it was first observed.
 */

export type TriggerStatusRow = Readonly<{
  triggerKey: string
  reasonCode: string
  decision: string
  createdAt: string
  /** Set when the decision was recorded for one specific run; that is the strongest attribution. */
  analysisRunId?: string | null
}>

export type TriggerStatus = Readonly<{
  triggerKey: string
  reasonCode: string
  decidedAt: string
  /**
   * The open a session-slot run served, in local wall-clock terms. Without it the panel said
   * "欧洲盘开盘分析（16:00）" for a run that happened at 01:21 the next morning, and the reader had no
   * way to tell which open it was or that it was a catch-up.
   */
  slotOpenAt?: string
  /** True when the run happened well after the open it served, i.e. it was caught up. */
  slotDelayed?: boolean
}>

/**
 * The run a timeline entry was published from: which run, what triggered it, and when it was queued.
 */
export type TriggerStatusRun = Readonly<{ id: string; triggerKey: string; queuedAt: string; completedAt?: string | null }>

export const triggerStatusPolicy = Object.freeze({
  version: 'marketAnalysisTriggerStatusPolicy.v1',
  /** Decisions the panel can explain; anything else would surface an untranslated token. */
  explainableReasonCodes: Object.freeze({
    significanceConfirmed: 'significance-confirmed',
    significanceBelowThreshold: 'significance-below-threshold',
    /** 只由 provider 发布的"意外"驱动的那次分析（设计 145 §8 A）。 */
    providerSurpriseConfirmed: 'provider-surprise-confirmed',
    semanticNoOp: 'semantic-no-op',
    intervalActive: 'interval-active',
    hourBudgetExhausted: 'hour-budget-exhausted',
    dayBudgetExhausted: 'day-budget-exhausted',
    scheduleReserveExhausted: 'schedule-reserve-exhausted',
    // One per open: the panel explains a run by its reason code, so these are what make the three
    // session slots tellable apart in the timeline.
    sessionSlotAsia: 'session-slot-asia',
    sessionSlotEurope: 'session-slot-europe',
    sessionSlotUs: 'session-slot-us',
    invalidSignificanceInput: 'invalid-significance-input',
    /** Not a ledger decision: the reader asked, and that is its own explanation. */
    manualRequest: 'manual-request',
    // The item path's own reasons. Without them a published item analysis — and every restart
    // compensation, which is what a reader actually asks about when a row shows no explanation —
    // was silently unattributed.
    severityConfirmed: 'severity-confirmed',
    mediumScoreConfirmed: 'medium-score-confirmed',
    marketReactionConfirmed: 'market-reaction-confirmed',
    restartInitialCompensated: 'restart-initial-compensated',
    restartReviewCompensated: 'restart-review-compensated'
  }),
  /** Reasons that describe a moment rather than a condition the gate keeps re-observing. */
  oneOffReasonCodes: Object.freeze([
    'manual-request', 'severity-confirmed', 'medium-score-confirmed', 'market-reaction-confirmed',
    'restart-initial-compensated', 'restart-review-compensated'
  ] as readonly string[]),
  /**
   * Keys this plan introduced, judged by the significance gate, plus the one historical key the
   * schedule replaced: `startup.refresh` was the 6-hour catch-up's key, and rows recorded under it
   * would lose their explanation line if it were dropped here as well as from the gate.
   */
  explainableTriggerKeys: Object.freeze([...analysisTriggerSourcePolicy.gateEligibleTriggerKeys, 'startup.refresh']),
  /** The item path's keys: judged by `analysisTriggerPolicy`, reported from its own ledger row. */
  itemTriggerKeys: analysisTriggerSourcePolicy.itemTriggerKeys,
  manualTriggerKeys: ['manual.refresh', 'manual.initial'] as readonly string[]
})

export function projectTriggerStatus(rows: readonly TriggerStatusRow[] | undefined, run: TriggerStatusRun | undefined): TriggerStatus | null {
  if (!run) return null
  const reasonCodes: readonly string[] = Object.values(triggerStatusPolicy.explainableReasonCodes)
  if (triggerStatusPolicy.manualTriggerKeys.includes(run.triggerKey)) {
    return withSlotOpen({ triggerKey: run.triggerKey, reasonCode: triggerStatusPolicy.explainableReasonCodes.manualRequest, decidedAt: run.queuedAt }, run)
  }
  // Gate keys and item keys are both explainable, each from its own ledger rows: the gate writes
  // them for the data-driven sources, `analysisTriggerPolicy` and the restart compensation write
  // them for the item path.
  if (!triggerStatusPolicy.explainableTriggerKeys.includes(run.triggerKey) && !triggerStatusPolicy.itemTriggerKeys.includes(run.triggerKey)) return null
  const decidedBy = run.completedAt ?? run.queuedAt
  const explainable = (rows ?? []).filter(row =>
    row.triggerKey === run.triggerKey &&
    reasonCodes.includes(row.reasonCode) &&
    // A decision taken after this run finished cannot have caused it.
    row.createdAt <= decidedBy)
  if (explainable.length === 0) return null
  // A decision that names this run outranks a same-key decision that merely precedes it in time:
  // that is what tells a restart compensation apart from an item that crossed the threshold.
  const forThisRun = explainable.filter(row => row.analysisRunId === run.id)
  const candidates = forThisRun.length > 0 ? forThisRun : explainable.filter(row => !row.analysisRunId)
  if (candidates.length === 0) return null
  const latest = [...candidates].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]!
  return withSlotOpen({ triggerKey: latest.triggerKey, reasonCode: latest.reasonCode, decidedAt: latest.createdAt }, run)
}

/**
 * Adds which open a session-slot run served, and whether it was a catch-up.
 *
 * The open is derived from the run's own queue time — the most recent occurrence of that slot at or
 * before it — rather than from the ledger's day token, which records the day of *delivery*: a 16:00
 * open served at 01:21 the next morning would otherwise be reported as an open that had not happened
 * yet.
 */
function withSlotOpen(status: TriggerStatus, run: TriggerStatusRun): TriggerStatus {
  const slot = slotForTriggerKey(status.triggerKey)
  if (!slot) return status
  const open = slotInstantAtOrBefore(slot, new Date(run.queuedAt))
  if (!open) return status
  return {
    ...status,
    slotOpenAt: open,
    slotDelayed: Date.parse(run.queuedAt) - Date.parse(open) > analysisSchedulePolicy.coverageWindowMs
  }
}
