import { describe, expect, it } from 'vitest'

import type { CapitalConditionsSnapshotResult } from '../../../contracts/intelligenceQueryContracts'
import type { AgentFact } from '../../../contracts/marketAnalysisContracts'
import type { EvidenceSnapshot } from '../../../contracts/marketAnalysisContracts'
import { buildAnalysisMessages } from '../analysis/analysisModelPrompt'
import { analysisRowsPerAsset, projectCapital } from './marketAnalysisContextProjection'

const asOf = '2026-10-30T12:00:00.000Z'
const at = (hoursAgo: number) => new Date(Date.parse(asOf) - hoursAgo * 3_600_000).toISOString()

/** Ascending trading days, one million per day of the ordinal, so sums stay hand-checkable. */
const tradingDays = (count: number) => Array.from({ length: count }, (_, index) => ({
  tradingDate: `2026-09-${String(index + 1).padStart(2, '0')}`,
  netFlowUsd: (index + 1) * 1_000_000,
  observedAt: at(2)
}))

function snapshot(tradingDayCount = 10): CapitalConditionsSnapshotResult {
  const rows = tradingDays(tradingDayCount)
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
    // Four stablecoin facts, five days on each of two assets, and one complete window on each.
    expect(observations.capital?.factCount).toBe(4 + analysisRowsPerAsset * 2 + 2)
  })

  it('publishes the complete cumulative windows, because the daily rows no longer carry the long view', () => {
    const { facts } = project(snapshot(20))
    const cumulative = (asset: string, days: number) =>
      facts.filter(fact => fact.subject === asset && fact.metric === `etf-net-flow-${days}d-usd`)

    // One to twenty (in millions) summed over five days is 90, over twenty days is 210.
    expect(cumulative('BTC', 5).map(fact => fact.value)).toEqual([90_000_000])
    expect(cumulative('BTC', 20).map(fact => fact.value)).toEqual([210_000_000])
    expect(cumulative('ETH', 5)).toHaveLength(1)
    expect(cumulative('ETH', 20)).toHaveLength(1)
  })

  it('publishes no cumulative fact for a window it could not fill — a short sum is a different number', () => {
    const { facts } = project(snapshot(10))
    expect(facts.filter(fact => fact.metric === 'etf-net-flow-5d-usd')).toHaveLength(2)
    // Twenty days of data were never there, so there is nothing to name as a twenty-day total.
    expect(facts.some(fact => fact.metric === 'etf-net-flow-20d-usd')).toBe(false)
  })

  it('dates the cumulative fact by the newest row it summed, not by the query time', () => {
    const { facts } = project(snapshot(20))
    const fiveDay = facts.find(fact => fact.metric === 'etf-net-flow-5d-usd')!
    expect(fiveDay.observedAt).toBe(at(2))
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

/**
 * The acceptance criterion for this work is not "the fact is in the snapshot" but "the fact is in
 * the prompt the model reads": a fact that loses its name on the way into the prompt leaves the
 * model with a machine identifier, and a fact that never makes the projection budget is not there
 * at all. Both are checked here, through the real prompt builder.
 */
function promptFor(facts: readonly AgentFact[]): string {
  const snapshot = {
    id: 'mi-es-capital', schemaVersion: 2, eventGroupId: 'mi-eg-capital', asOf, dataCutoff: asOf,
    snapshotHash: 'capital', profileId: 'crypto-market-analysis-v1',
    facts, missingDomains: [], caveats: [], evidenceRefs: [], sourceHealth: [],
    createdAt: asOf, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1'
  } as EvidenceSnapshot
  // The rules live in the system message; the facts are in the user message. Both are read by
  // the model, so the assertion covers the whole conversation rather than one half of it.
  return buildAnalysisMessages(snapshot).map(message => message.content).join('\n')
}

describe('the cumulative ETF facts reach the model prompt', () => {
  it('names both windows in the prompt the model is handed', () => {
    const prompt = promptFor(project(snapshot(20)).facts)
    expect(prompt).toContain('ETF 5 日累计净流入')
    expect(prompt).toContain('ETF 20 日累计净流入')
  })

  it('keeps the stablecoin readings in the same prompt', () => {
    const prompt = promptFor(project(snapshot(20)).facts)
    expect(prompt).toContain('稳定币')
    expect(prompt).toContain('当前值')
  })
})
