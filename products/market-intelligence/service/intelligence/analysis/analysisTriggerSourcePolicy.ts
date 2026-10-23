import { isMarketAnalysisCanonicalUtc, type AnalysisPhase } from '../../../contracts/marketAnalysisContracts'
import { analysisSessionSlots, triggerKeyForSlot, type AnalysisSessionSlot } from './analysisSchedulePolicy'

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
  return analysisTriggerSourcePolicy.gateEligibleTriggerKeys.includes(triggerKey)
}

/**
 * Phase for the trigger keys this plan introduces. Existing keys keep today's mapping, so
 * `manual.*` rows continue to feed the item path's phase cooldown exactly as before.
 */
export function phaseForNewTriggerKey(triggerKey: string): AnalysisPhase {
  return isGateEligible(triggerKey) ? analysisTriggerSourcePolicy.correctionPhase : analysisTriggerSourcePolicy.defaultPhase
}

/** Kept next to the policy so a caller cannot smuggle a malformed `asOf` past the gate. */
export function isGateTimestamp(value: string | null): boolean {
  return value === null || (isMarketAnalysisCanonicalUtc(value) && Number.isFinite(Date.parse(value)))
}
