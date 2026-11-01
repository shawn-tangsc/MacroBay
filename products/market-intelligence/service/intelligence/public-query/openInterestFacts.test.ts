import { describe, expect, it } from 'vitest'

import { buildAnalysisMessages } from '../analysis/analysisModelPrompt'
import { analysisModelVocabulary } from '../analysis/analysisModelVocabulary'
import { readableAnalysisFactValue } from '../../../contracts/marketAnalysisReadableText'
import type { AgentFact, EvidenceSnapshot } from '../../../contracts/marketAnalysisContracts'
import type { FundingRateHistoryResult } from '../../../contracts/intelligenceQueryContracts'
import type { OpenInterestHistoryResult } from '../../../contracts/openInterestHistory'
import { projectFunding } from './marketAnalysisContextProjection'

const asOf = '2026-10-29T00:00:00.000Z'
const at = (minutesAgo: number) => new Date(Date.parse(asOf) - minutesAgo * 60_000).toISOString()

const funding: FundingRateHistoryResult = {
  state: 'available',
  asOf,
  btc: [24, 16, 8, 0].map(hours => ({ observedAt: at(hours * 60), ratePercent: hours === 0 ? 0.0062 : 0.0121 })),
  eth: [24, 16, 8, 0].map(hours => ({ observedAt: at(hours * 60), ratePercent: hours === 0 ? -0.0031 : 0.0002 }))
}

const positioning: OpenInterestHistoryResult = {
  state: 'available',
  asOf,
  window: '24h',
  btc: [{ observedAt: at(15), notionalUsd: 8_940_000_000 }],
  eth: [{ observedAt: at(15), notionalUsd: 2_460_000_000 }],
  change: { btc: { h1Pct: -0.4, h24Pct: -6.5 }, eth: { h1Pct: 0.2, h24Pct: 6.4 } },
  liquidationHintsState: 'available'
}

function project(oi: OpenInterestHistoryResult | undefined) {
  const facts: AgentFact[] = []
  const caveats = new Set<string>()
  const observations = {}
  projectFunding(funding, oi, asOf, facts, caveats, observations)
  return facts.filter(fact => fact.sourceId === 'binance-futures-positioning' && ['open-interest-notional-usd', 'open-interest-change-24h-pct', 'positioning-state'].includes(fact.metric))
}

describe('open interest facts', () => {
  it('carries the level, the 24h direction and the state per asset', () => {
    const facts = project(positioning)
    expect(facts).toHaveLength(6)
    expect(facts.find(fact => fact.subject === 'BTC' && fact.metric === 'open-interest-notional-usd')?.value).toBe(8_940_000_000)
    expect(facts.find(fact => fact.subject === 'BTC' && fact.metric === 'open-interest-change-24h-pct')?.value).toBe(-6.5)
    expect(facts.find(fact => fact.subject === 'BTC' && fact.metric === 'positioning-state')?.value).toBe('deleveraging')
    // ETH: open interest up 6.4% while the rate is negative — the crowding case, not the refill one.
    expect(facts.find(fact => fact.subject === 'ETH' && fact.metric === 'positioning-state')?.value).toBe('short-crowded')
  })

  it('keeps one identity per metric so a moving number reads as changed, not added', () => {
    const first = project(positioning).map(fact => fact.factId).sort()
    const later = project({ ...positioning, btc: [{ observedAt: at(0), notionalUsd: 8_900_000_000 }] }).map(fact => fact.factId).sort()
    expect(later).toEqual(first)
  })

  it('drops the change and the state when the reference buckets are missing', () => {
    const sparse = project({ ...positioning, change: { eth: { h24Pct: 2.7 } } })
    expect(sparse.filter(fact => fact.subject === 'BTC').map(fact => fact.metric)).toEqual(['open-interest-notional-usd'])
  })

  it('adds nothing when the positioning half is unavailable', () => {
    expect(project({ state: 'unavailable', failureCode: 'open-interest-history-query-unavailable' })).toHaveLength(0)
    expect(project(undefined)).toHaveLength(0)
  })

  it('names the state in Chinese for the model instead of handing it the identifier', () => {
    expect(readableAnalysisFactValue(analysisModelVocabulary, 'positioning-state', 'deleveraging', null)).toBe('去杠杆 · 多头减仓')
    expect(readableAnalysisFactValue(analysisModelVocabulary, 'open-interest-notional-usd', 8_940_000_000, 'USD')).toContain('亿')
  })
})

function snapshotWith(facts: readonly AgentFact[]): EvidenceSnapshot {
  return {
    id: 'mi-es-1', schemaVersion: 1, eventGroupId: 'mi-eg-1', asOf, dataCutoff: asOf, snapshotHash: 'h1',
    profileId: 'crypto-market-analysis-v1', facts, missingDomains: [], caveats: [], evidenceRefs: [],
    sourceHealth: [], createdAt: asOf, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1'
  } as EvidenceSnapshot
}

function systemPrompt(facts: readonly AgentFact[]): string {
  return buildAnalysisMessages(snapshotWith(facts)).find(message => message.role === 'system')!.content
}

describe('open interest prompt rule', () => {
  const stateFact = project(positioning).find(fact => fact.metric === 'positioning-state')!

  it('appears only when a positioning state is actually in the snapshot', () => {
    expect(systemPrompt([stateFact])).toContain('持仓与费率组合态')
    expect(systemPrompt([])).not.toContain('持仓与费率组合态')
  })

  it('tells the model to quote both numbers and to keep the single-venue scope', () => {
    const prompt = systemPrompt([stateFact])
    expect(prompt).toContain('必须同时给出')
    expect(prompt).toContain('禁止写成「全网」')
  })
})
