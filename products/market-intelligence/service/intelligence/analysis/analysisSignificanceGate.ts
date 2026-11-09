import { normalizeMacroRouteMonths, type MacroRoute } from '../public-query/macroRouteQuery'
import { analysisBudgetPolicy, decideBudget, type DailyQuota } from './analysisBudgetPolicy'
import { countAnalysisRuns, lastAutoRunAt, type AnalysisRunCounts } from './analysisRunCounter'
import { evaluateSignificance, type SignificanceDecision } from './analysisSignificancePolicy'
import { analysisRunLineOf, isGateEligible } from './analysisTriggerSourcePolicy'
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
  countRuns: (now: string, excludedRowId?: string) => AnalysisRunCounts
  lastAutoRunAt: (eventGroupId: string, now: string) => string | null
  recordDecision: (input: Readonly<{ eventGroupId: string; triggerKey: string; changeHash: string; decision: 'queued' | 'skipped'; reasonCode: string }>) => void
  /**
   * Flips one attempt's own row to skipped. Required, not optional: a gate that refuses an attempt
   * without being able to mark it is precisely the case where the counting formula keeps charging
   * the day for a model call that never happened.
   */
  updateDecision: (rowId: string, decision: 'skipped', reasonCode: string) => void
  /**
   * 当日额度用尽时告诉读者一次（P3）。只在 `day-budget-exhausted` 这一种拒绝上调用：
   * 小时窗口、合并区间、时段的保留位都不是「今天的次数用完了」。缺省表示未装配通知运行时。
   */
  notifyQuotaExhausted?: (input: Readonly<{
    used: number
    limit: number
    occurredAt: string
    /** 哪个闸门拒的：按线（带线名）还是全局兜底（不带线名）。 */
    scope: Readonly<{ kind: 'line'; line: 'event' | 'calendar' }> | Readonly<{ kind: 'global' }>
  }>) => Promise<void>
}>

export type SignificanceGateInput = Readonly<{
  eventGroupId: string
  triggerKey: string
  asOf: string
  previousSnapshot: Readonly<{ facts: readonly unknown[]; asOf: string }> | undefined | null
  /**
   * The ledger row the trigger line wrote for this attempt. Present only for attempts that were
   * recorded as allowed before reaching the gate; keys the trigger line does not own (the calendar
   * line) have no attempt row and the gate records its own decision as before.
   */
  attemptLedgerId?: string
}>

export type SignificanceGateOutcome = Readonly<{
  decision: 'queued' | 'skipped'
  reasonCode: string | null
  signals: readonly SignificanceSignal[]
  triggeredEventKeys: ReadonlySet<string>
  route: MacroRoute | null
  usedPreviousAsOf: string | null
  /** 每日额度拒绝背后的「已用 / 上限」；其它拒绝与放行都是 null。 */
  dailyQuota: DailyQuota | null
}>

export function createAnalysisSignificanceGate(dependencies: SignificanceGateDependencies) {
  /**
   * 「今天的次数用完了」只在每日额度这一种拒绝上通知一次；同一天的重复提交由平台按 UTC 日键合并，
   * 所以这里不必自己数次数（那是去重键的职责，写两处迟早会不一致）。
   */
  const notifyQuotaExhausted = async (
    reasonCode: string | null,
    quota: DailyQuota | undefined,
    line: 'event' | 'calendar'
  ): Promise<void> => {
    if (quota === undefined) return
    // 两个日闸门各有一个码：按线拒绝说线名，全局兜底不带线名（否则读者一算就不平）。
    const scope = reasonCode === analysisBudgetPolicy.reasonCodes.daily
      ? { kind: 'line' as const, line }
      : reasonCode === analysisBudgetPolicy.reasonCodes.dailyGlobal
        ? { kind: 'global' as const }
        : undefined
    if (scope === undefined) return
    await dependencies.notifyQuotaExhausted?.({ used: quota.used, limit: quota.limit, occurredAt: dependencies.now(), scope })
  }
  return {
    async evaluate(input: SignificanceGateInput): Promise<SignificanceGateOutcome> {
      const line = analysisRunLineOf(input.triggerKey)
      // The item line is budgeted here but never judged for significance: its own trigger policy
      // already decided that the change was worth a look. It reaches the budget with the same
      // counts every other line uses, and a refusal rewrites its attempt row instead of adding one.
      if (line === 'event') {
        const now = dependencies.now()
        const budget = decideBudget({
          triggerKey: input.triggerKey, now,
          lastAutoRunAt: dependencies.lastAutoRunAt(input.eventGroupId, now),
          ...dependencies.countRuns(now, input.attemptLedgerId)
        })
        if (budget.decision === 'skipped' && budget.reasonCode !== null) {
          // The freeze boundary refuses an item-line payload without its attempt row, so the id is
          // always present here; without one there is no counted attempt to correct either.
          if (input.attemptLedgerId !== undefined) dependencies.updateDecision(input.attemptLedgerId, 'skipped', budget.reasonCode)
          await notifyQuotaExhausted(budget.reasonCode, budget.dailyQuota, 'event')
          return { decision: 'skipped', reasonCode: budget.reasonCode, signals: [], triggeredEventKeys: new Set(), route: null, usedPreviousAsOf: null, dailyQuota: budget.dailyQuota ?? null }
        }
        return { decision: 'queued', reasonCode: null, signals: [], triggeredEventKeys: new Set(), route: null, usedPreviousAsOf: null, dailyQuota: null }
      }
      // Not a key this gate judges: hand it back untouched and record nothing.
      if (!isGateEligible(input.triggerKey)) {
        return { decision: 'queued', reasonCode: null, signals: [], triggeredEventKeys: new Set(), route: null, usedPreviousAsOf: null, dailyQuota: null }
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
        // A refused attempt that arrived with its own ledger row rewrites that row; anything else
        // (the calendar line, the session slots) records a decision of its own as it always has.
        if (input.attemptLedgerId !== undefined && decision.decision === 'skipped') {
          dependencies.updateDecision(input.attemptLedgerId, 'skipped', decision.reasonCode)
        } else {
          dependencies.recordDecision({
            eventGroupId: input.eventGroupId, triggerKey: input.triggerKey, changeHash: decision.changeHash,
            decision: decision.decision, reasonCode: decision.reasonCode
          })
        }
      }
      // 事件线在上面已单独返回，走到这里的按日历线处理（会话时段不是这条闸门的输入）。
      await notifyQuotaExhausted(decision.reasonCode, decision.dailyQuota ?? undefined, 'calendar')
      return {
        decision: decision.decision, reasonCode: decision.reasonCode, signals: decision.signals,
        triggeredEventKeys: new Set(decision.signals.map(signal => signal.eventKey)),
        route, usedPreviousAsOf: previous?.asOf ?? null, dailyQuota: decision.dailyQuota
      }
    }
  }
}

export { countAnalysisRuns, lastAutoRunAt }
