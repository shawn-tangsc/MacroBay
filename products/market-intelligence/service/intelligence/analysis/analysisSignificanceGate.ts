import { normalizeMacroRouteMonths, type MacroRoute } from '../public-query/macroRouteQuery'
import { analysisBudgetPolicy, decideBudget, type DailyQuota } from './analysisBudgetPolicy'
import { countAnalysisRuns, lastAutoRunAt, type AnalysisRunCounts } from './analysisRunCounter'
import { analysisSignificancePolicy, evaluateSignificance, type SignificanceDecision } from './analysisSignificancePolicy'
import { analysisRunLineOf, isGateEligible } from './analysisTriggerSourcePolicy'
import { projectPreviousBaseline, type PreviousSignificanceBaseline } from './previousSignificanceBaseline'
import type { SignificanceBaseline, SignificanceSignal } from './significanceChangeMatcher'

/**
 * 日历读不到时，闸门不许把「不知道」判成「没有变化」。
 *
 * 只改一种判定：本来会因「变化低于阈值」被跳过的，改判为放行（fail-open）。预算、间隔、
 * 时段这些拒绝理由一律不透支——读不到日历不代表可以多花一次额度。放行时 `reasonCode` 留空，
 * 因为「读不到所以先分析一次」还没有自己的文案码；加码要同时加两处文案，不在这一笔里造。
 */
type ReadStreak = Readonly<{ official: number; provider: number }>

/**
 * 连续读不到的次数，按侧计。
 *
 * 读不到时放行是「宁可多分析一次」的兜底；但如果它一直读不到，这兜底会每个周期都放行一次，
 * 直到把当天额度耗光——一次配置错误就能吃掉整天的分析机会。所以同侧连续两次不可读之后，
 * 兜底关闭；只要有一次读到就清零。它只关这一个口子，预算/间隔/时段三道闸门一律不动。
 */
function nextReadStreaks(route: MacroRoute, streak: ReadStreak): ReadStreak {
  const step = (side: MacroRoute['official'] | MacroRoute['provider'], previous: number): number => {
    if (side.state === 'available') return 0
    // `not-wired` 不是「读不到」：那个 build 本来就没有这条日历，不计入连续次数。
    if (side.reasonCode === 'not-wired') return previous
    return previous + 1
  }
  return Object.freeze({
    official: step(route.official, streak.official),
    provider: step(route.provider, streak.provider)
  })
}

function evaluateCalendarSignificance(
  input: Parameters<typeof evaluateSignificance>[0],
  route: MacroRoute,
  streak: ReadStreak
): Readonly<{ decision: SignificanceDecision; streaks: ReadStreak }> {
  const decision = evaluateSignificance(input)
  const streaks = nextReadStreaks(route, streak)
  // 只有当前仍不可读、且还没超过两次的那一侧，才允许把「低于阈值」改判为放行。
  const unreadable = [['official', route.official, streaks.official], ['provider', route.provider, streaks.provider]] as const
  const failOpenAllowed = unreadable.some(([, side, count]) =>
    side.state === 'unavailable' && side.reasonCode !== 'not-wired' && count <= 2)
  if (!failOpenAllowed) return { decision, streaks }
  if (decision.decision !== 'skipped' || decision.reasonCode !== analysisSignificancePolicy.reasonCodes.belowThreshold) {
    return { decision, streaks }
  }
  return {
    decision: Object.freeze({
      ...decision, decision: 'queued' as const,
      reasonCode: analysisSignificancePolicy.reasonCodes.calendarUnavailable, signals: Object.freeze([])
    }),
    streaks
  }
}

/**
 * 一行诊断，专门回答「这次为什么要/不要按读不到处理」。
 *
 * `not-wired` 不触发 fail-open，所以它不发任何信号；但正因为它不发信号，必须留下能被查到的
 * 记录——否则接线哪天被改坏，看起来和「这个 build 本来就没接」一模一样。
 */
export function formatCalendarReadDiagnostic(route: MacroRoute): string {
  return JSON.stringify({
    kind: 'analysis-calendar-read',
    official: { state: route.official.state, reasonCode: route.official.reasonCode ?? null },
    provider: { state: route.provider.state, reasonCode: route.provider.reasonCode ?? null },
    asOf: route.asOf, months: route.months
  })
}

/** 把两侧状态摊平成策略层认识的基线；策略层只认数据，不认状态。 */
function flattenBaseline(route: MacroRoute): SignificanceBaseline {
  return { official: route.official.facts, provider: route.provider.facts, months: route.months, asOf: route.asOf }
}

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
   * 连续「读不到」的计数，按 UTC 日与侧持久化（跨重启不清零）。
   *
   * 缺省时退回进程内存，只用于测试或没装持久层的老装配；生产装配必须提供，否则一次重启
   * 会白送两次放宽，正是「一次配置错误烧光额度」的形状。
   */
  readCalendarReadStreak?: (utcDay: string) => Readonly<{ official: number; provider: number }>
  writeCalendarReadStreak?: (input: Readonly<{ utcDay: string; side: 'official' | 'provider'; count: number; updatedAt: string }>) => void
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
  const utcDayOf = (now: string): string => now.slice(0, 10)
  /** 当天窗口的计数：有持久层就读它，没有就用进程内存。 */
  function calendarReadStreak(now: string): ReadStreak {
    return dependencies.readCalendarReadStreak?.(utcDayOf(now)) ?? memoryStreak
  }
  /** 只写有变化的侧；跨天由主键 `utc_day` 自然分开，不需要显式清零。 */
  function persistCalendarReadStreak(now: string, next: ReadStreak): void {
    if (!dependencies.writeCalendarReadStreak) {
      memoryStreak.official = next.official
      memoryStreak.provider = next.provider
      return
    }
    const utcDay = utcDayOf(now)
    for (const side of ['official', 'provider'] as const) {
      if (next[side] !== memoryStreak[side] || next[side] !== calendarReadStreak(now)[side]) {
        dependencies.writeCalendarReadStreak({ utcDay, side, count: next[side], updatedAt: now })
      }
    }
    memoryStreak.official = next.official
    memoryStreak.provider = next.provider
  }
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
  // 没有持久层时用的兜底：只在进程内有效，生产装配由 repository 提供。
  // 装配漏掉持久层时这里只 warn 一次（不是每 tick）：静默退回内存会让「重启不清零」悄悄失效，
  // 而所有用例仍然绿——那正是要防的形状。
  const persistenceWired = dependencies.readCalendarReadStreak !== undefined && dependencies.writeCalendarReadStreak !== undefined
  if (!persistenceWired) {
    console.warn('[analysis] calendar-read streak falls back to process memory: persistence is not wired')
  }
  const memoryStreak = { official: 0, provider: 0 }
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
      const evaluated = evaluateCalendarSignificance({
        triggerKey: input.triggerKey,
        now,
        lastAutoRunAt: dependencies.lastAutoRunAt(input.eventGroupId, now),
        previousAsOf: previous?.asOf ?? null,
        current: flattenBaseline(route),
        previous: previous?.values ?? null,
        ...dependencies.countRuns(now)
      }, route, calendarReadStreak(now))
      persistCalendarReadStreak(now, evaluated.streaks)
      const decision = evaluated.decision
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
