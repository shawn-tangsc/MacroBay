import { isMarketAnalysisCanonicalUtc, type AnalysisPhase } from '../../../contracts/marketAnalysisContracts'
import { analysisSessionSlots, isScheduledSlotTriggerKey, triggerKeyForSlot, type AnalysisSessionSlot } from './analysisSchedulePolicy'

/**
 * Which caller asked for this analysis, and what that means for the significance gate.
 *
 * The freeze job is a shared path: item-driven work (already judged by
 * `analysisTriggerPolicy`), manual refreshes (a human asked) and the automatic sources all
 * arrive there. Before this policy the payload carried a single `manual.refresh` key
 * regardless of caller, so "the reader asked for it" and "the refresher noticed something"
 * were indistinguishable at the only place where the decision can be made.
 *
 * Trigger keys ride the existing `triggerKey` payload field (already whitelisted for the
 * freeze job) instead of adding a field: `assertPayload` rejects unknown keys outright.
 */

export const analysisTriggerSourcePolicy = Object.freeze({
  version: 'marketAnalysisTriggerSourcePolicy.v2',
  /** Replaces the old `marketAnalysisCalendarUpdateTriggerPolicy.minimumStoredRows`. */
  calendarTriggerCondition: 'high-importance-content-change' as const,
  /**
   * Keys the gate judges. The three session slots are eligible rather than exempt: they still need
   * the budget's reserved line, and `analysisSignificancePolicy` is what lets them through without
   * a data change (running at an open is the trigger).
   */
  gateEligibleTriggerKeys: ['calendar.refresh', ...analysisSessionSlots.map(triggerKeyForSlot)] as readonly string[],
  /**
   * Module signals are one key per rule (`signal.<moduleId>.<ruleId>`), so they are registered by
   * the shape of the key instead of by listing rules that do not exist yet. Two registrations read
   * this one pattern: the gate judges the key, and the budget line spends the event line — a signal
   * that skipped the gate would spend a model call without a decision, and one left on the default
   * line would eat the calendar's nine a day.
   */
  /** `signal.<moduleId>.<ruleId>`, both kebab tokens: exactly two segments, no third. */
  signalTriggerKeyPattern: /^signal\.[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/,
  gateExemptTriggerKeys: ['manual.refresh', 'manual.initial'] as readonly string[],
  itemTriggerKeys: ['macro.actual.first-confirmed', 'market-reaction.15m'] as readonly string[],
  correctionPhase: 'correction' as AnalysisPhase,
  defaultPhase: 'initial' as AnalysisPhase
})

export type AnalysisTriggerSource = 'calendar-refresh' | 'item-change' | 'session-slot' | 'manual'

export const analysisTriggerSources: readonly AnalysisTriggerSource[] = ['calendar-refresh', 'item-change', 'session-slot', 'manual']

/**
 * Maps a caller to its trigger key. `item-change` keeps the keys that
 * `analysisTriggerPolicy.decide` already produces, so this policy does not own them.
 *
 * `session-slot` needs the slot it is serving: one key per open, so the ledger, the budget's
 * reserved line and the reader's "why did this run" all name the open instead of a generic clock.
 */
export function resolveTriggerKey(source: AnalysisTriggerSource, mode: 'initial' | 'refresh', slot?: AnalysisSessionSlot): string {
  if (source === 'calendar-refresh') return 'calendar.refresh'
  if (source === 'session-slot') {
    if (!slot) throw new Error('analysis-invalid-request')
    return triggerKeyForSlot(slot)
  }
  if (source === 'manual') return mode === 'refresh' ? 'manual.refresh' : 'manual.initial'
  return mode === 'refresh' ? 'market-reaction.15m' : 'macro.actual.first-confirmed'
}

/** A human asked for this run: no significance, interval or budget limit applies. */
export function isGateExempt(triggerKey: string): boolean {
  return analysisTriggerSourcePolicy.gateExemptTriggerKeys.includes(triggerKey)
}

/** Only the data-driven sources are judged by the gate; everything else passes through. */
export function isGateEligible(triggerKey: string): boolean {
  return isSignalTriggerKey(triggerKey) || analysisTriggerSourcePolicy.gateEligibleTriggerKeys.includes(triggerKey)
}

/**
 * One key per module rule: `signal.<moduleId>.<ruleId>`.
 *
 * Shape rather than an enumerated list, because the rule set is the module's own policy and this
 * file must not grow a copy of it. The pattern is narrow on purpose — `signal.debug` (no rule),
 * `signal.open-interest` (no rule), `signal.a.b.c` (a third segment) and a bare `signal` all stay
 * unregistered instead of silently spending the event line.
 */
export function isSignalTriggerKey(triggerKey: string): boolean {
  // Two segments, one key per rule: `signal.<moduleId>.<ruleId>`. A key such as `signal.debug` is a
  // typo, not a registration: letting it through spends the event line on a rule that does not
  // exist, and nothing in the panel would say where it went. Both segments are kebab tokens, so a
  // third segment (`signal.a.b.c`) fails too instead of being read as "some rule under some module".
  return analysisTriggerSourcePolicy.signalTriggerKeyPattern.test(triggerKey)
}

/**
 * Phase for the trigger keys this plan introduces. Existing keys keep today's mapping, so
 * `manual.*` rows continue to feed the item path's phase cooldown exactly as before.
 */
export function phaseForNewTriggerKey(triggerKey: string): AnalysisPhase {
  return isGateEligible(triggerKey) ? analysisTriggerSourcePolicy.correctionPhase : analysisTriggerSourcePolicy.defaultPhase
}

/**
 * Which budget line a delivery belongs to. One function, so the day and the hour and the quota
 * cannot disagree about the same attempt:
 *
 * - `scheduled` — the three session opens, which carry their own daily reserve.
 * - `event` — the item line's two keys, registered in `itemTriggerKeys`, plus every module signal
 *   (`signal.*`), which shares that allowance rather than the calendar's.
 * - `calendar` — everything else, including any future key. The default is the stricter line:
 *   a new source must be registered explicitly to get the event line's larger allowance.
 */
export type AnalysisRunLine = 'event' | 'calendar' | 'scheduled'

export function analysisRunLineOf(triggerKey: string): AnalysisRunLine {
  if (isScheduledSlotTriggerKey(triggerKey)) return 'scheduled'
  if (isSignalTriggerKey(triggerKey)) return 'event'
  return (analysisTriggerSourcePolicy.itemTriggerKeys as readonly string[]).includes(triggerKey) ? 'event' : 'calendar'
}

/** Kept next to the policy so a caller cannot smuggle a malformed `asOf` past the gate. */
export function isGateTimestamp(value: string | null): boolean {
  return value === null || (isMarketAnalysisCanonicalUtc(value) && Number.isFinite(Date.parse(value)))
}
