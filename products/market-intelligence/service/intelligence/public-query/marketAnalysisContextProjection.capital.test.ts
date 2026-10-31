import { describe, expect, it } from 'vitest'

import type { CapitalConditionsSnapshotResult } from '../../../contracts/intelligenceQueryContracts'
import type { AgentFact } from '../../../contracts/marketAnalysisContracts'
import { analysisRowsPerAsset, projectCapital } from './marketAnalysisContextProjection'

const asOf = '2026-10-30T12:00:00.000Z'
const at = (hoursAgo: number) => new Date(Date.parse(asOf) - hoursAgo * 3_600_000).toISOString()

/** Ten trading days per asset, so the cap has something to drop. Flow equals the day's ordinal. */
const tradingDays = Array.from({ length: 10 }, (_, index) => ({
  tradingDate: `2026-10-${String(index + 8).padStart(2, '0')}`,
  netFlowUsd: (index + 1) * 1_000_000,
  observedAt: at(2)
}))

function snapshot(tradingDayCount = tradingDays.length): CapitalConditionsSnapshotResult {
  const rows = tradingDays.slice(0, tradingDayCount)
  return {
    state: 'available',
    asOf,
    etf: {
      state: 'available', schemaVersion: 1, sourceId: '0xrouter', windowEnd: rows.at(-1)!.tradingDate, verifiedAt: at(1),
      btc: { asset: 'BTC', rows },
      eth: { asset: 'ETH', rows }
    },
    coreStablecoins: {
      observedAt: at(2), verifiedAt: at(2), currentUsd: 252.1e9,
      change1dUsd: -1e9, change1dPercent: -0.4, change7dUsd: -3e9, change7dPercent: -1.2, change30dUsd: -6e9, change30dPercent: -2.3
    },
    conclusion: 'partial'
  }
}

function project(value: CapitalConditionsSnapshotResult) {
  const facts: AgentFact[] = []
  const caveats = new Set<string>()
  const observations: Parameters<typeof projectCapital>[4] = {}
  projectCapital(value, undefined, asOf, facts, caveats, observations)
  return { facts, caveats, observations }
}

const etfFacts = (facts: readonly AgentFact[], asset: string) =>
  facts.filter(fact => fact.metric === 'etf-net-flow-usd' && fact.subject === asset)

describe('ETF daily flows in the analysis snapshot', () => {
  it('projects only the newest trading days per asset', () => {
    const { facts } = project(snapshot())
    const btc = etfFacts(facts, 'BTC')
    expect(analysisRowsPerAsset).toBe(5)
    expect(btc).toHaveLength(analysisRowsPerAsset)
    // The tail of an ascending series: the five newest days, not the five oldest.
    expect(btc.map(fact => fact.value)).toEqual([6e6, 7e6, 8e6, 9e6, 10e6])
    expect(ethRowsValues(facts)).toEqual([6e6, 7e6, 8e6, 9e6, 10e6])
  })

  it('keeps every row when the window holds fewer than the cap — no padding, no invention', () => {
    const { facts } = project(snapshot(3))
    expect(etfFacts(facts, 'BTC')).toHaveLength(3)
    expect(etfFacts(facts, 'ETH')).toHaveLength(3)
  })

  it('still carries the four stablecoin readings, which are the first thing the page reads', () => {
    const { facts } = project(snapshot())
    const stablecoins = facts.filter(fact => fact.subject === 'stablecoins').map(fact => fact.metric)
    expect(stablecoins).toEqual(['current-usd', 'change-1d-usd', 'change-7d-usd', 'change-30d-usd'])
  })

  it('counts what it projected, not how many rows the snapshot carried', () => {
    const { observations } = project(snapshot())
    // Four stablecoin facts plus five days on each of two assets.
    expect(observations.capital?.factCount).toBe(4 + analysisRowsPerAsset * 2)
  })

  it('marks a shorter window as fewer facts rather than as a missing source', () => {
    const { facts, caveats, observations } = project(snapshot(2))
    expect(observations.capital?.factCount).toBe(4 + 2 * 2)
    expect(observations.capital?.queryState).toBe('available')
    expect(caveats.has('etf-unavailable')).toBe(false)
    expect(facts.some(fact => fact.metric === 'etf-net-flow-usd')).toBe(true)
  })
})

function ethRowsValues(facts: readonly AgentFact[]): readonly unknown[] {
  return etfFacts(facts, 'ETH').map(fact => fact.value)
}
