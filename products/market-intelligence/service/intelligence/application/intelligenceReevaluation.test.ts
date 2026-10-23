import { describe, expect, it } from 'vitest'

import { planIntelligenceReevaluation } from './intelligenceReevaluation'

describe('intelligenceReevaluation', () => {
  it('scopes watchlist changes to intersecting symbols only', () => {
    const plan = planIntelligenceReevaluation({
      trigger: 'watchlist',
      changedSymbols: ['BTCUSDT', 'ETHUSDT']
    })

    expect(plan.jobs).toHaveLength(2)
    expect(plan.jobs.every((job) => job.jobId === 'market-intelligence.reevaluateClusters')).toBe(true)
    expect(plan.jobs.map((job) => job.payload.scopeKey)).toEqual(['BTCUSDT', 'ETHUSDT'])
  })

  it('scopes portfolio changes to changed active exposure symbols', () => {
    const plan = planIntelligenceReevaluation({
      trigger: 'portfolio',
      changedSymbols: ['SOLUSDT']
    })

    expect(plan.jobs[0]?.payload).toMatchObject({
      scopeType: 'active-position',
      scopeKey: 'SOLUSDT'
    })
  })

  it('queues sentiment reevaluation for risk profile changes', () => {
    const plan = planIntelligenceReevaluation({ trigger: 'risk-profile' })

    expect(plan.jobs.some((job) => job.jobId === 'market-intelligence.reevaluateSentimentScopes')).toBe(true)
  })

  it('recomputes linked cluster and item ids on membership changes', () => {
    const plan = planIntelligenceReevaluation({
      trigger: 'cluster-membership',
      clusterIds: ['cluster-1'],
      itemIds: ['item-1', 'item-2']
    })

    expect(plan.jobs[0]?.payload).toMatchObject({
      clusterId: 'cluster-1',
      itemIds: ['item-1', 'item-2']
    })
  })

  it('returns bounded payloads without scanning full history', () => {
    const plan = planIntelligenceReevaluation({
      trigger: 'watchlist',
      changedSymbols: Array.from({ length: 20 }, (_value, index) => `SYM${index}`)
    })

    expect(plan.jobs.length).toBeLessThanOrEqual(10)
  })
})
