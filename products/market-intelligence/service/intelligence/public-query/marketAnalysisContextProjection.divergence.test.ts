import { describe, expect, it } from 'vitest'

import type { CapitalConditionsSnapshotResult } from '../../../contracts/intelligenceQueryContracts'
import type { MarketDivergenceResult } from '../../../contracts/marketDivergence'
import type { AgentFact } from '../../../contracts/marketAnalysisContracts'
import { projectCapital } from './marketAnalysisContextProjection'

const asOf = '2026-10-30T12:00:00.000Z'
const at = (hoursAgo: number) => new Date(Date.parse(asOf) - hoursAgo * 3_600_000).toISOString()

const capital: CapitalConditionsSnapshotResult = {
  state: 'available',
  asOf,
  etf: { state: 'unavailable' },
  coreStablecoins: {
    observedAt: at(2), verifiedAt: at(2), currentUsd: 252.1e9,
    change1dUsd: -1e9, change1dPercent: -0.4, change7dUsd: -3e9, change7dPercent: -1.2, change30dUsd: -6e9, change30dPercent: -2.3
  },
  conclusion: 'partial'
}

const divergence: MarketDivergenceResult = {
  state: 'available',
  asOf,
  rows: [{
    pairId: 'liquidity-leverage',
    direction: 'bearish',
    legs: [
      { id: 'stablecoin', value: -1.2, unit: 'percent', observedAt: at(2) },
      { id: 'open-interest', value: 3.4, unit: 'percent', observedAt: at(1) },
      { id: 'funding', value: -0.0032, unit: 'percent-per-8h', observedAt: at(1) }
    ]
  }],
  withheld: [],
  // 纯检测器不下升级结论：升级由看得到原始各腿的调用方决定（`marketDivergence.ts:290`）。
  escalated: false
}

function project(value: MarketDivergenceResult | undefined) {
  const facts: AgentFact[] = []
  const caveats = new Set<string>()
  // 第六个参数是 observations（第五个是 caveats），按真实签名取类型。
  const observations: Parameters<typeof projectCapital>[5] = {}
  projectCapital(capital, value, asOf, facts, caveats, observations)
  return { facts, observations }
}

describe('divergence in the analysis snapshot', () => {
  it('adds one fact per diverging pair, carrying its direction rather than a number', () => {
    const { facts } = project(divergence)
    const fact = facts.find(entry => entry.metric === 'divergence-liquidity-leverage')!
    expect(fact.domain).toBe('capital')
    expect(fact.value).toBe('bearish')
    expect(fact.unit).toBeNull()
    // The anchor is the slowest leg, so the fact is dated by the stablecoin reading, not the newest.
    expect(fact.observedAt).toBe(at(2))
  })

  it('counts the fact in the domain observation, so the budget sees it', () => {
    const withDivergence = project(divergence).observations.capital!
    const without = project(undefined).observations.capital!
    expect(withDivergence.factCount).toBe(without.factCount + 1)
  })

  it('adds nothing when there is no divergence — absence is not a zero', () => {
    expect(project({ state: 'empty', asOf, withheld: [], escalated: false }).facts.some(f => String(f.metric).startsWith('divergence-'))).toBe(false)
    expect(project(undefined).facts.some(f => String(f.metric).startsWith('divergence-'))).toBe(false)
  })
})
