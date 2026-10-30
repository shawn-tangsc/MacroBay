import { describe, expect, it } from 'vitest'

import {
  MARKET_ANALYSIS_CONTEXT_CAVEATS,
  MARKET_ANALYSIS_POLICY_PATH_POLICY
} from '../../../contracts/marketAnalysisContracts'
import type { PolicyPathReading } from '../policy-path/policyPathQueryService'
import { buildMarketAnalysisContext } from './marketAnalysisContextQuery'

const AS_OF = '2026-09-25T08:30:00.000Z'

const reading: PolicyPathReading = {
  meetingDate: '2026-11-04',
  daysUntilMeeting: 40,
  hasProjectionMaterials: false,
  phase: { kind: 'normal' },
  targetRange: { lowerPercent: 3.75, upperPercent: 4 },
  sep: {
    asOf: '2026-09-16',
    medianPath: { y2026: 4.1, y2027: 4.1, y2028: 3.9, y2029: 3.6, longerRun: 3.2 },
    medianCurrentYear: 4.1,
    sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomcprojtabl20260916.htm'
  },
  lastDecision: {
    vote: { for: 10, against: 2 },
    dissents: [{ name: 'Cook', preferred: 'raise' }],
    statementUrl: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm'
  },
  probability: {
    venue: 'polymarket',
    asOf: '2026-09-25T08:20:00.000Z',
    outcome: 'hike-25',
    value: 0.706,
    changeInPp24h: 2,
    quote: { bid: 0.7, ask: 0.72 },
    points: 40
  },
  staleness: 'live'
}

function service(read: PolicyPathReading | { state: 'disabled' } | { state: 'unavailable' }) {
  return {
    queryPolicyPath: async () => ('state' in read ? read : { state: 'available' as const, reading: read })
  }
}

async function context(read: Parameters<typeof service>[0]) {
  const result = await buildMarketAnalysisContext(
    { eventGroupId: 'mi-eg-policy', asOf: AS_OF, domains: ['macro'] },
    service(read) as never
  )
  expect(result.state).toBe('available')
  if (result.state !== 'available') throw new Error('context unavailable')
  return result
}

function policyFacts(result: Awaited<ReturnType<typeof context>>) {
  return result.facts.filter(fact => fact.sourceId === 'policy-path-market')
}

describe('policy path analysis facts', () => {
  it('projects every reading with its own as-of and a public source link', async () => {
    const result = await context(reading)
    const facts = policyFacts(result)
    const metrics = facts.map(fact => fact.metric)

    expect(metrics).toEqual(expect.arrayContaining([
      MARKET_ANALYSIS_POLICY_PATH_POLICY.metrics.nextMeetingDate,
      MARKET_ANALYSIS_POLICY_PATH_POLICY.metrics.impliedProbability,
      MARKET_ANALYSIS_POLICY_PATH_POLICY.metrics.probabilityChange24h,
      MARKET_ANALYSIS_POLICY_PATH_POLICY.metrics.targetRange,
      MARKET_ANALYSIS_POLICY_PATH_POLICY.metrics.sepMedianCurrentYear,
      MARKET_ANALYSIS_POLICY_PATH_POLICY.metrics.sepMedianPath,
      MARKET_ANALYSIS_POLICY_PATH_POLICY.metrics.lastDecisionVote
    ]))
    expect(facts.find(fact => fact.metric === MARKET_ANALYSIS_POLICY_PATH_POLICY.metrics.impliedProbability))
      .toMatchObject({ subject: 'hike-25', value: 71, unit: 'percent', observedAt: '2026-09-25T08:20:00.000Z' })
    expect(facts.find(fact => fact.metric === MARKET_ANALYSIS_POLICY_PATH_POLICY.metrics.probabilityChange24h))
      .toMatchObject({ unit: 'pp', value: 2, observedAt: '2026-09-25T08:20:00.000Z' })
    expect(facts.find(fact => fact.metric === MARKET_ANALYSIS_POLICY_PATH_POLICY.metrics.targetRange))
      .toMatchObject({ value: '3.75%-4.00%', observedAt: '2026-09-16T00:00:00.000Z' })
    expect(facts.find(fact => fact.metric === MARKET_ANALYSIS_POLICY_PATH_POLICY.metrics.sepMedianCurrentYear))
      .toMatchObject({ value: 4.1, unit: 'percent', observedAt: '2026-09-16T00:00:00.000Z' })
    expect(facts.find(fact => fact.metric === MARKET_ANALYSIS_POLICY_PATH_POLICY.metrics.sepMedianPath)?.value)
      .toContain('2026 年 4.1%')
    expect(facts.find(fact => fact.metric === MARKET_ANALYSIS_POLICY_PATH_POLICY.metrics.lastDecisionVote)?.value)
      .toBe('10-2（反对：Cook 主张加息）')

    for (const fact of facts) {
      expect(fact.sourceUrl).toMatch(/^https:\/\//)
      const evidence = result.evidenceRefs.find(ref => ref.evidenceRefId === fact.evidenceRefId)
      expect(evidence).toMatchObject({ sourceId: 'policy-path-market', occurredAt: fact.observedAt, sourceUrl: fact.sourceUrl })
    }
    expect(result.caveats).toEqual(expect.arrayContaining([
      MARKET_ANALYSIS_POLICY_PATH_POLICY.caveats.oddsAreMarketPricing,
      MARKET_ANALYSIS_POLICY_PATH_POLICY.caveats.projectionsFromLatestSepMeeting
    ]))
    expect(result.domainAccess.find(domain => domain.domain === 'macro')?.caveats)
      .toEqual(expect.arrayContaining([MARKET_ANALYSIS_POLICY_PATH_POLICY.caveats.oddsAreMarketPricing]))
  })

  it('falls back to the official SEP table when the stored link is not an admitted URL', async () => {
    const result = await context({ ...reading, sep: { ...reading.sep!, sourceUrl: 'http://insecure.example/sep' } })
    const sepFact = policyFacts(result).find(fact => fact.metric === MARKET_ANALYSIS_POLICY_PATH_POLICY.metrics.sepMedianCurrentYear)

    expect(sepFact?.sourceUrl).toBe('https://www.federalreserve.gov/monetarypolicy/fomcprojtabl20260916.htm')
    expect(result.caveats).toContain(MARKET_ANALYSIS_CONTEXT_CAVEATS.policyPathSourceUrlInvalid)
  })

  it('links a FRED fallback range to FRED even when a decision statement exists', async () => {
    const result = await context({ ...reading, targetRange: { ...reading.targetRange!, source: 'fred' } })
    const range = policyFacts(result).find(fact => fact.metric === MARKET_ANALYSIS_POLICY_PATH_POLICY.metrics.targetRange)

    expect(range?.sourceUrl).toBe('https://fred.stlouisfed.org/series/DFEDTARU')
  })

  it('keeps the probability and names the gap when the 24-hour change is not available yet', async () => {
    const { probability, ...withoutProbability } = reading
    const result = await context({
      ...withoutProbability,
      probability: { venue: probability!.venue, asOf: probability!.asOf, outcome: probability!.outcome, value: probability!.value, points: probability!.points }
    })
    const facts = policyFacts(result)

    expect(facts.some(fact => fact.metric === MARKET_ANALYSIS_POLICY_PATH_POLICY.metrics.impliedProbability)).toBe(true)
    expect(facts.some(fact => fact.metric === MARKET_ANALYSIS_POLICY_PATH_POLICY.metrics.probabilityChange24h)).toBe(false)
    expect(result.caveats).toContain(MARKET_ANALYSIS_CONTEXT_CAVEATS.policyPathChange24hUnavailable)
  })

  it('declares the policy share when a smaller global budget cuts it', async () => {
    const result = await buildMarketAnalysisContext(
      { eventGroupId: 'mi-eg-policy', asOf: AS_OF, domains: ['macro'], maxFacts: 1 },
      service(reading) as never
    )

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    expect(result.caveats).toContain(MARKET_ANALYSIS_CONTEXT_CAVEATS.policyPathTruncated)
  })

  it('omits the SEP facts and states the gap when no projection is stored', async () => {
    const { sep: _sep, ...withoutSep } = reading
    const result = await context(withoutSep)
    const metrics = policyFacts(result).map(fact => fact.metric)

    expect(metrics).not.toContain(MARKET_ANALYSIS_POLICY_PATH_POLICY.metrics.sepMedianCurrentYear)
    expect(metrics).not.toContain(MARKET_ANALYSIS_POLICY_PATH_POLICY.metrics.sepMedianPath)
    expect(result.caveats).toContain(MARKET_ANALYSIS_CONTEXT_CAVEATS.policyPathSepUnavailable)
  })

  it('contributes nothing at all when the reader has the source switched off', async () => {
    const result = await context({ state: 'disabled' })

    expect(policyFacts(result)).toEqual([])
    expect(result.caveats).not.toContain(MARKET_ANALYSIS_CONTEXT_CAVEATS.policyPathUnavailable)
    expect(result.caveats).not.toContain(MARKET_ANALYSIS_POLICY_PATH_POLICY.caveats.oddsAreMarketPricing)
  })

  it('names an enabled-but-empty source as a gap instead of inventing a neutral policy', async () => {
    const result = await context({ state: 'unavailable' })

    expect(policyFacts(result)).toEqual([])
    expect(result.caveats).toContain(MARKET_ANALYSIS_CONTEXT_CAVEATS.policyPathUnavailable)
    expect(result.domainAccess.find(domain => domain.domain === 'macro')?.caveats)
      .toContain(MARKET_ANALYSIS_CONTEXT_CAVEATS.policyPathUnavailable)
  })
})
