import { isMarketAnalysisCanonicalUtc, type AnalysisPhase } from '../../../contracts/marketAnalysisContracts'
import type { AnalysisChange } from './eventGroupService'

export const analysisTriggerPolicy = Object.freeze({
  version: 'cryptoMarketAnalysisTriggerPolicy.v1',
  cooldownMs: 30 * 60 * 1_000,
  reviewWindowMs: 120 * 60 * 1_000,
  maximumReviews: 2,
  maximumConcurrentRuns: 2,
  maximumHourlyTriggers: 12,
  maximumDailyTriggers: 48,
  verificationIntervalMs: 5 * 60 * 1_000,
  marketMove15mThresholdPct: 0.75,
  fundingDelta8hThresholdPctPoints: 0.01,
  mediumMinimumConfirmedDomains: 2,
  mediumMinimumScore: 2
})

const analysisScoreBucketByDomain = Object.freeze({
  macro: 'macro',
  'external-market': 'external-market',
  'btc-eth-reaction': 'btc-eth-reaction',
  capital: 'capital-funding',
  funding: 'capital-funding',
  'capital-funding': 'capital-funding'
} as const)

export type TriggerHistoryEntry = Readonly<{ phase: AnalysisPhase; triggeredAt: string }>
export type TriggerDecisionInput = Readonly<{
  eventGroupId: string
  now: string
  change: AnalysisChange
  confirmedDomains: readonly string[]
  recentTriggers: readonly TriggerHistoryEntry[]
  reviewCount: number
  hourTriggerCount: number
  dayTriggerCount: number
  runningCount: number
  hasInitialRun: boolean
  lastTriggeredAt: string | null
  lastTriggeredPhase?: AnalysisPhase
  sourceHealthOnly?: boolean
}>
export type TriggerDecision = Readonly<{
  decision: 'queued' | 'skipped'
  phase: AnalysisPhase | null
  triggerKey: string
  reasonCode: string
  score: number
}>
export type AnalysisTriggerPolicy = Readonly<{ decide: (input: TriggerDecisionInput) => TriggerDecision; score: (input: TriggerDecisionInput) => number }>

export function createAnalysisTriggerPolicy(): AnalysisTriggerPolicy {
  const score = (input: TriggerDecisionInput): number => {
    const comparable = input.change.comparability !== 'proxy' && input.change.comparability !== 'not-comparable' && input.change.sourceKind === 'official'
    if (!comparable || !input.change.confirmed) return 0
    return new Set(input.confirmedDomains.flatMap(domain => {
      const bucket = analysisScoreBucketByDomain[domain as keyof typeof analysisScoreBucketByDomain]
      return bucket ? [bucket] : []
    })).size
  }

  const decide = (input: TriggerDecisionInput): TriggerDecision => {
    const scoreValue = score(input)
    const triggerKey = input.hasInitialRun ? 'market-reaction.15m' : 'macro.actual.first-confirmed'
    const skip = (reasonCode: string): TriggerDecision => ({ decision: 'skipped', phase: null, triggerKey, reasonCode, score: scoreValue })
    const phase: AnalysisPhase = input.hasInitialRun ? 'review' : 'initial'
    const validNumber = (value: number): boolean => Number.isFinite(value) && value >= 0
    const validOptionalNumber = (value: number | null): boolean => value === null || Number.isFinite(value)
    if (!isMarketAnalysisCanonicalUtc(input.now) || !Number.isFinite(Date.parse(input.now)) ||
      !validNumber(input.reviewCount) || !validNumber(input.hourTriggerCount) || !validNumber(input.dayTriggerCount) || !validNumber(input.runningCount) ||
      !validOptionalNumber(input.change.marketMove15mPct) || !validOptionalNumber(input.change.fundingDeltaPctPoints) ||
      input.lastTriggeredAt !== null && (!isMarketAnalysisCanonicalUtc(input.lastTriggeredAt) || !Number.isFinite(Date.parse(input.lastTriggeredAt)))) return skip('invalid-trigger-input')
    if (input.change.previousHash !== null && input.change.previousHash === input.change.nextHash) return skip('semantic-no-op')
    if (input.sourceHealthOnly) return skip('source-health-only')
    if (input.change.sourceKind !== 'official' || input.change.comparability === 'proxy' || input.change.comparability === 'not-comparable') return skip('evidence-not-triggerable')
    if (!Number.isFinite(input.reviewCount) || (input.reviewCount >= analysisTriggerPolicy.maximumReviews && input.hasInitialRun)) return skip('review-limit-reached')
    if (input.lastTriggeredAt && input.lastTriggeredPhase === phase && Date.parse(input.now) - Date.parse(input.lastTriggeredAt) < analysisTriggerPolicy.cooldownMs) return skip('cooldown-active')
    const latestPhaseTrigger = [...input.recentTriggers].reverse().find(trigger => trigger.phase === (input.hasInitialRun ? 'review' : 'initial'))
    if (latestPhaseTrigger && Date.parse(input.now) - Date.parse(latestPhaseTrigger.triggeredAt) < analysisTriggerPolicy.cooldownMs) return skip('cooldown-active')
    if (input.hourTriggerCount >= analysisTriggerPolicy.maximumHourlyTriggers) return skip('hour-budget-exhausted')
    if (input.dayTriggerCount >= analysisTriggerPolicy.maximumDailyTriggers) return skip('day-budget-exhausted')
    if (input.runningCount >= analysisTriggerPolicy.maximumConcurrentRuns) return skip('concurrency-budget-exhausted')
    if (!input.change.confirmed) return skip('change-unconfirmed')
    const reaction = Math.abs(input.change.marketMove15mPct ?? 0) >= analysisTriggerPolicy.marketMove15mThresholdPct || Math.abs(input.change.fundingDeltaPctPoints ?? 0) >= analysisTriggerPolicy.fundingDelta8hThresholdPctPoints
    if (input.hasInitialRun) {
      const reviewDeadline = input.recentTriggers.find(trigger => trigger.phase === 'initial')?.triggeredAt
      if (!reviewDeadline || Date.parse(input.now) - Date.parse(reviewDeadline) > analysisTriggerPolicy.reviewWindowMs) return skip('review-window-expired')
      return reaction ? { decision: 'queued', phase: 'review', triggerKey, reasonCode: 'market-reaction-confirmed', score: scoreValue } : skip('review-reaction-below-threshold')
    }
    if (input.change.severity === 'high' || input.change.severity === 'critical') return { decision: 'queued', phase: 'initial', triggerKey, reasonCode: 'severity-confirmed', score: scoreValue }
    if (input.change.severity === 'medium' && new Set(input.confirmedDomains).size >= analysisTriggerPolicy.mediumMinimumConfirmedDomains && scoreValue >= analysisTriggerPolicy.mediumMinimumScore) return { decision: 'queued', phase: 'initial', triggerKey, reasonCode: 'medium-score-confirmed', score: scoreValue }
    return skip('trigger-score-insufficient')
  }
  return { decide, score }
}
