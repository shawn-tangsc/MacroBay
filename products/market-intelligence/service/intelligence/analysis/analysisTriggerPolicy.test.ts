import { describe, expect, it } from 'vitest'

import { createAnalysisTriggerPolicy, type TriggerDecisionInput } from './analysisTriggerPolicy'

const now = '2026-09-27T01:00:00.000Z'
const base: TriggerDecisionInput = {
  eventGroupId: 'mi-eg-1', now, change: {
    changeId: 'c1', domain: 'macro', eventRef: 'e1', subject: 'CPI', severity: 'medium',
    changedFields: ['actual'], previousHash: 'a', nextHash: 'b', observedAt: now,
    publishedAt: now, confirmed: true, sourceCount: 2, marketMove15mPct: null,
    fundingDeltaPctPoints: null, sourceKind: 'official', groupType: 'macro',
    countryCode: 'US', periodKey: '2026-08', macroFamily: 'CPI'
  }, confirmedDomains: ['macro', 'capital'], recentTriggers: [], reviewCount: 0,
  hourTriggerCount: 0, dayTriggerCount: 0, runningCount: 0, hasInitialRun: false,
  lastTriggeredAt: null
}

describe('analysisTriggerPolicy', () => {
  it('requires two confirmed domains and score two for medium events', () => {
    const policy = createAnalysisTriggerPolicy()
    expect(policy.decide({ ...base, confirmedDomains: ['macro'] }).decision).toBe('skipped')
    expect(policy.decide(base).phase).toBe('initial')
  })

  it('counts only named evidence score buckets', () => {
    const policy = createAnalysisTriggerPolicy()
    expect(policy.score({ ...base, confirmedDomains: ['unknown-a', 'unknown-b'] })).toBe(0)
    expect(policy.score({ ...base, confirmedDomains: ['macro', 'capital', 'capital'] })).toBe(2)
  })

  it('does not score proxy or not-comparable evidence', () => {
    const policy = createAnalysisTriggerPolicy()
    const decision = policy.decide({ ...base, confirmedDomains: ['macro', 'capital'], change: { ...base.change, sourceKind: 'proxy', comparability: 'proxy' } })
    expect(decision.decision).toBe('skipped')
    expect(decision.reasonCode).toBe('evidence-not-triggerable')
    expect(policy.decide({ ...base, change: { ...base.change, severity: 'critical', sourceKind: 'proxy', comparability: 'proxy' } }).decision).toBe('skipped')
  })

  it('writes a skipped decision for cooldown, review limit, and hourly/daily budgets', () => {
    const policy = createAnalysisTriggerPolicy()
    expect(policy.decide({ ...base, lastTriggeredAt: '2026-09-27T00:50:00.000Z', lastTriggeredPhase: 'initial' }).reasonCode).toBe('cooldown-active')
    expect(policy.decide({ ...base, hasInitialRun: true, reviewCount: 2, change: { ...base.change, severity: 'high' } }).reasonCode).toBe('review-limit-reached')
    expect(policy.decide({ ...base, hourTriggerCount: 12 }).reasonCode).toBe('hour-budget-exhausted')
    expect(policy.decide({ ...base, dayTriggerCount: 48 }).reasonCode).toBe('day-budget-exhausted')
  })

  it('skips semantic no-op and review only when market reaction crosses a named boundary', () => {
    const policy = createAnalysisTriggerPolicy()
    expect(policy.decide({ ...base, change: { ...base.change, previousHash: 'same', nextHash: 'same' } }).reasonCode).toBe('semantic-no-op')
    const reviewHistory = [{ phase: 'initial' as const, triggeredAt: '2026-09-27T00:55:00.000Z' }]
    expect(policy.decide({ ...base, hasInitialRun: true, recentTriggers: reviewHistory, change: { ...base.change, severity: 'low', marketMove15mPct: 0.75 } }).phase).toBe('review')
    expect(policy.decide({ ...base, hasInitialRun: true, recentTriggers: reviewHistory, change: { ...base.change, severity: 'low', marketMove15mPct: 0.7499 } }).decision).toBe('skipped')
  })

  it('uses absolute funding movement at the exact threshold', () => {
    const policy = createAnalysisTriggerPolicy()
    const history = [{ phase: 'initial' as const, triggeredAt: '2026-09-27T00:55:00.000Z' }]
    expect(policy.decide({ ...base, hasInitialRun: true, recentTriggers: history, change: { ...base.change, severity: 'low', fundingDeltaPctPoints: -0.01 } }).phase).toBe('review')
    expect(policy.decide({ ...base, hasInitialRun: true, recentTriggers: history, change: { ...base.change, severity: 'low', fundingDeltaPctPoints: 0.0099 } }).decision).toBe('skipped')
  })

  it('does not trigger for source health changes alone', () => {
    const policy = createAnalysisTriggerPolicy()
    expect(policy.decide({ ...base, sourceHealthOnly: true }).reasonCode).toBe('source-health-only')
  })

  it('fails closed for invalid budgets, timestamps, and reaction values', () => {
    const policy = createAnalysisTriggerPolicy()
    expect(policy.decide({ ...base, hourTriggerCount: Number.NaN }).reasonCode).toBe('invalid-trigger-input')
    expect(policy.decide({ ...base, dayTriggerCount: -1 }).reasonCode).toBe('invalid-trigger-input')
    expect(policy.decide({ ...base, now: 'not-a-time' }).reasonCode).toBe('invalid-trigger-input')
    expect(policy.decide({ ...base, change: { ...base.change, marketMove15mPct: Number.NaN, severity: 'high' } }).reasonCode).toBe('invalid-trigger-input')
  })

  it('applies cooldown to the matching analysis phase only', () => {
    const policy = createAnalysisTriggerPolicy()
    const reviewInput = { ...base, hasInitialRun: true, recentTriggers: [{ phase: 'initial' as const, triggeredAt: '2026-09-27T00:55:00.000Z' }], lastTriggeredAt: '2026-09-27T00:55:00.000Z', lastTriggeredPhase: 'initial' as const, change: { ...base.change, marketMove15mPct: 0.75 } }
    expect(policy.decide(reviewInput).phase).toBe('review')
    expect(policy.decide({ ...reviewInput, lastTriggeredPhase: 'review' as const }).reasonCode).toBe('cooldown-active')
  })
})
