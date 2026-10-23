import type { AnalysisPhase } from '../../../contracts/marketAnalysisContracts'
import { hashMarketAnalysisJson } from './analysisHash'
import { decideBudget, type BudgetDecision } from './analysisBudgetPolicy'
import { isScheduledSlotTriggerKey, slotForTriggerKey, type AnalysisSessionSlot } from './analysisSchedulePolicy'
import { localDayToken } from './analysisSlotCoverage'
import { isGateEligible } from './analysisTriggerSourcePolicy'
import { providerReleaseSurprisePolicy, providerReleaseSurprises, type ProviderReleaseSurprise } from './providerReleaseSurprisePolicy'
import { diffSignificance, type PreviousFactKey, type SignificanceBaseline, type SignificanceSignal } from './significanceChangeMatcher'

/**
 * The gate's decision, composed from the three pure units.
 *
 * Order matters and is deliberate: budget first (a limit is a limit regardless of what the
 * data says), then the session slots (defined as "run at this open even when nothing moved"),
 * then the significance comparison. `reasonCode` is null only when the gate did not decide at
 * all — a trigger key it does not judge — so an exempt or pass-through run records nothing.
 */

export const analysisSignificancePolicy = Object.freeze({
  version: 'marketAnalysisSignificancePolicy.v2',
  triggerableImportance: 'high' as const,
  reasonCodes: Object.freeze({
    confirmed: 'significance-confirmed',
    belowThreshold: 'significance-below-threshold',
    /**
     * 只由 provider 的"意外"（偏离预期超过阈值）驱动的那次分析。
     *
     * 与宏观序列的变化共用同一次判定、同一份预算、同一个 30 分钟合并窗口，所以同一条发布不会既走
     * provider 线又走官方线；只有原因需要分开：读者问"为什么这次分析了"时，答案必须是那一条意外。
     */
    providerSurprise: providerReleaseSurprisePolicy.reasonCode,
    // One code per open: the panel explains a run by its reason code, so a single generic code
    // would make the three opens indistinguishable in the timeline.
    sessionSlotAsia: 'session-slot-asia',
    sessionSlotEurope: 'session-slot-europe',
    sessionSlotUs: 'session-slot-us',
    invalidInput: 'invalid-significance-input'
  })
})

export type SignificanceDecision = Readonly<{
  decision: 'queued' | 'skipped'
  reasonCode: string | null
  phase: AnalysisPhase | null
  signals: readonly SignificanceSignal[]
  changeHash: string
}>

export type SignificanceEvaluationInput = Readonly<{
  triggerKey: string
  now: string
  lastAutoRunAt: string | null
  previousAsOf: string | null
  current: SignificanceBaseline
  previous: ReadonlyMap<PreviousFactKey, string | null> | null
  hourRuns: number
  dayRuns: number
  eventRunsToday: number
  scheduledRunsToday: number
}>

export function significanceChangeHash(signals: readonly SignificanceSignal[]): string {
  // Content only: no `asOf`, so the same movement keeps the same hash across ticks and the
  // ledger's (group, triggerKey, changeHash) dedupe holds.
  return hashMarketAnalysisJson(signals
    .map(signal => [signal.kind, signal.eventKey, signal.metric, signal.previousValue, signal.value])
    .sort((left, right) => left.join('\u0000').localeCompare(right.join('\u0000'))))
}

export function evaluateSignificance(input: SignificanceEvaluationInput): SignificanceDecision {
  const decide = (kind: 'queued' | 'skipped', reasonCode: string | null, signals: readonly SignificanceSignal[],
    phase: AnalysisPhase | null = null, changeHash = significanceChangeHash(signals)): SignificanceDecision =>
    ({ decision: kind, reasonCode, phase, signals, changeHash })
  // Not a key this gate judges: pass through without deciding or recording, and without a
  // phase — the freeze payload already carries the phase the caller decided.
  if (!isGateEligible(input.triggerKey) && !isScheduledSlotTriggerKey(input.triggerKey)) return decide('queued', null, [])
  const budget: BudgetDecision = decideBudget({
    triggerKey: input.triggerKey, now: input.now, lastAutoRunAt: input.lastAutoRunAt,
    hourRuns: input.hourRuns, dayRuns: input.dayRuns, eventRunsToday: input.eventRunsToday, scheduledRunsToday: input.scheduledRunsToday
  })
  if (budget.decision === 'skipped') return decide('skipped', budget.reasonCode ?? analysisSignificancePolicy.reasonCodes.invalidInput, [])
  const slot = slotForTriggerKey(input.triggerKey)
  if (slot) return decide('queued', sessionSlotReasonCode(slot), [], 'correction', sessionSlotChangeHash(slot, input.now))
  const signals = diffSignificance(input.previous, input.current, input.previousAsOf)
    .filter(signal => signal.importance === analysisSignificancePolicy.triggerableImportance)
  const surprises = providerReleaseSurprises({
    observations: input.current.provider, previous: input.previous, previousAsOf: input.previousAsOf, asOf: input.current.asOf
  })
  const surpriseSignals = surprises.map(toProviderSurpriseSignal)
  /**
   * 已发布观测的"变化"可以**解释**一次分析，但不能**单独触发**它。
   *
   * 这是本条口径的要点（§8 A："例行发布仍不驱动分析"）：一条 provider 发布拿到实际值，哪怕此前没见过，
   * 也不再算触发理由——只有**显著偏离预期**才算。变化本身照旧写进信号交给模型（它解释了这次分析里
   * 发生了什么），所以这里分的是"触发资格"，不是"要不要说"。
   */
  const releasedProviderKeys = new Set(input.current.provider
    .filter(observation => observation.lifecycleState === 'released')
    .map(observation => observation.eventKey))
  const triggering = signals.filter(signal => !releasedProviderKeys.has(signal.eventKey))
  // 同一条发布既"变了"又"偏了"时，信号里只留**意外**那一条：实际值从无到有就是这次发布，而读者要
  // 知道的是它离预期有多远。两条都留着只是同一件事说两遍。
  const surprisedKeys = new Set(surprises.map(surprise => surprise.eventKey))
  const reported = [...signals.filter(signal => !surprisedKeys.has(signal.eventKey)), ...surpriseSignals]
  if (triggering.length > 0) return decide('queued', analysisSignificancePolicy.reasonCodes.confirmed, reported, 'correction')
  if (surpriseSignals.length > 0) return decide('queued', analysisSignificancePolicy.reasonCodes.providerSurprise, reported, 'correction')
  return decide('skipped', analysisSignificancePolicy.reasonCodes.belowThreshold, [])
}

/** 一条 provider 意外，写成与变化信号同一种形状：模型在提示词里读到的就是这一句。 */
function toProviderSurpriseSignal(surprise: ProviderReleaseSurprise): SignificanceSignal {
  return Object.freeze({
    kind: 'provider-surprise', eventKey: surprise.eventKey, titleKey: surprise.titleKey, metric: 'actual',
    importance: analysisSignificancePolicy.triggerableImportance, previousValue: null, value: surprise.actual,
    expectedValue: surprise.consensus
  })
}

/** The reason code the panel explains one open's run with. */
export function sessionSlotReasonCode(slot: AnalysisSessionSlot): string {
  if (slot === 'europe') return analysisSignificancePolicy.reasonCodes.sessionSlotEurope
  if (slot === 'us') return analysisSignificancePolicy.reasonCodes.sessionSlotUs
  return analysisSignificancePolicy.reasonCodes.sessionSlotAsia
}

/**
 * A slot's ledger identity: the open plus the local day it was served on.
 *
 * The ledger dedupes on (event group, trigger key, change hash) and its upsert keeps the first
 * `created_at`. A constant hash therefore made every later delivery of the same open invisible to
 * the run counter and to the delivery check — the panel documented exactly that symptom for the old
 * floor ("a repeated floor decision keeps its original created_at"). Including the day gives each
 * day's delivery its own row and its own timestamp.
 */
export function sessionSlotChangeHash(slot: AnalysisSessionSlot, now: string): string {
  return `session-slot:${slot}:${localDayToken(now)}`
}
