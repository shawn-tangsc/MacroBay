import { normalizeMacroRouteMonths, type MacroRoute } from '../public-query/macroRouteQuery'
import { countAnalysisRuns, lastAutoRunAt, type AnalysisRunCounts } from './analysisRunCounter'
import { evaluateSignificance, type SignificanceDecision } from './analysisSignificancePolicy'
import { isGateEligible } from './analysisTriggerSourcePolicy'
import { projectPreviousBaseline, type PreviousSignificanceBaseline } from './previousSignificanceBaseline'
import type { SignificanceSignal } from './significanceChangeMatcher'

/**
 * The gate itself: the one place that decides whether a data-driven analysis may spend a model
 * call, and the one place that records why.
 *
 * It runs *before* the evidence context is built, so a skipped evaluation costs one local route
 * read and nothing else — no snapshot, no run, no tokens. Trigger keys it does not judge (the
 * item line, which `analysisTriggerPolicy` already decided, and manual requests) pass through
 * without a decision being recorded, so they can never be double-counted or overwritten in the
 * ledger.
 *
 * Dependencies are injected rather than imported so the whole decision is testable without a
 * database, a job runtime or a network.
 */

export type SignificanceGateDependencies = Readonly<{
  now: () => string
  queryMacroRoute: (input: Readonly<{ asOf: string; months: readonly string[] }>) => Promise<MacroRoute>
  countRuns: (now: string) => AnalysisRunCounts
  lastAutoRunAt: (eventGroupId: string, now: string) => string | null
  recordDecision: (input: Readonly<{ eventGroupId: string; triggerKey: string; changeHash: string; decision: 'queued' | 'skipped'; reasonCode: string }>) => void
}>

export type SignificanceGateInput = Readonly<{
  eventGroupId: string
  triggerKey: string
  asOf: string
  previousSnapshot: Readonly<{ facts: readonly unknown[]; asOf: string }> | undefined | null
}>

export type SignificanceGateOutcome = Readonly<{
  decision: 'queued' | 'skipped'
  reasonCode: string | null
  signals: readonly SignificanceSignal[]
  triggeredEventKeys: ReadonlySet<string>
  route: MacroRoute | null
  usedPreviousAsOf: string | null
}>

export function createAnalysisSignificanceGate(dependencies: SignificanceGateDependencies) {
  return {
    async evaluate(input: SignificanceGateInput): Promise<SignificanceGateOutcome> {
      // Not a key this gate judges: hand it back untouched and record nothing.
      if (!isGateEligible(input.triggerKey)) {
        return { decision: 'queued', reasonCode: null, signals: [], triggeredEventKeys: new Set(), route: null, usedPreviousAsOf: null }
      }
      const previous: PreviousSignificanceBaseline | null = projectPreviousBaseline(input.previousSnapshot as never)
      const now = dependencies.now()
      const route = await dependencies.queryMacroRoute({ asOf: input.asOf, months: normalizeMacroRouteMonths(input.asOf, previous?.asOf ?? null) })
      const decision: SignificanceDecision = evaluateSignificance({
        triggerKey: input.triggerKey,
        now,
        lastAutoRunAt: dependencies.lastAutoRunAt(input.eventGroupId, now),
        previousAsOf: previous?.asOf ?? null,
        current: route,
        previous: previous?.values ?? null,
        ...dependencies.countRuns(now)
      })
      if (decision.reasonCode !== null) {
        dependencies.recordDecision({
          eventGroupId: input.eventGroupId, triggerKey: input.triggerKey, changeHash: decision.changeHash,
          decision: decision.decision, reasonCode: decision.reasonCode
        })
      }
      return {
        decision: decision.decision, reasonCode: decision.reasonCode, signals: decision.signals,
        triggeredEventKeys: new Set(decision.signals.map(signal => signal.eventKey)),
        route, usedPreviousAsOf: previous?.asOf ?? null
      }
    }
  }
}

export { countAnalysisRuns, lastAutoRunAt }
