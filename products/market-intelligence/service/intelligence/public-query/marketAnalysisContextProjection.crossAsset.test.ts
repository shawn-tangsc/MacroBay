import { describe, expect, it } from 'vitest'

import type { CrossAssetRange, CrossAssetSnapshot } from '../../../contracts/crossAssetObservationContracts'
import type { AgentFact, AnalysisDomain } from '../../../contracts/marketAnalysisContracts'
import { crossAssetAnalysisWindowPolicy } from '../cross-asset/crossAssetAnalysisWindows'
import { projectCrossAsset, type MarketAnalysisDomainObservation } from './marketAnalysisContextProjection'

const asOf = '2026-10-13T15:50:00.000Z'

/** A snapshot whose curves actually carry the returns the windows look back over. */
function snapshot(range: CrossAssetRange, overrides: Partial<CrossAssetSnapshot> = {}): CrossAssetSnapshot {
  const end = Date.parse(asOf)
  const stepMs = range === '7d' ? 3_600_000 : 300_000
  const length = range === '1h' ? 13 : range === '24h' ? 289 : 169
  const curve = (perStep: number) => Array.from({ length }, (_, index) => ({
    at: new Date(end - (length - 1 - index) * stepMs).toISOString(),
    // A steady climb, so the return over N points back is exactly N * perStep.
    returnPercent: index * perStep
  }))
  const metric = { state: 'available' as const, value: 2 }
  const perAsset = <T,>(btc: T, eth: T, index: T) => ({ btc, eth, index })
  return {
    schemaVersion: 1, mode: 'historical', servedAt: asOf, asOf, range,
    analysisEnd: asOf, windowStart: new Date(end - (length - 1) * stepMs).toISOString(),
    historyCoverage: perAsset({ count: length, expectedCount: length, complete: true }, { count: length, expectedCount: length, complete: true }, { count: length, expectedCount: length, complete: true }),
    curves: perAsset(curve(0.1), curve(0.05), curve(0.02)),
    closedReturns: perAsset({ '5m': metric, '15m': metric, '1h': metric, '4h': metric, '24h': metric, '7d': metric }, { '5m': metric, '15m': metric, '1h': metric, '4h': metric, '24h': metric, '7d': metric }, { '5m': metric, '15m': metric, '1h': metric, '4h': metric, '24h': metric, '7d': metric }),
    correlations: { indexBtc: { state: 'unavailable', reason: 'missing', sampleCount: 0, expectedCount: 288 }, indexEth: { state: 'unavailable', reason: 'missing', sampleCount: 0, expectedCount: 288 } },
    relativeReturns: { btcMinusIndex: metric, ethMinusBtc: metric },
    observationKey: { indexBtc: 'unavailable', ethBtc: 'unavailable' },
    // The licensed index answers the row in these fixtures; the proxy leg has its own case below.
    indexSource: 'real' as const,
    ...overrides
  } as CrossAssetSnapshot
}

function project(snapshots: ReadonlyMap<CrossAssetRange, CrossAssetSnapshot>) {
  const facts: AgentFact[] = []
  const caveats = new Set<string>()
  const observations: Partial<Record<AnalysisDomain, MarketAnalysisDomainObservation>> = {}
  projectCrossAsset(snapshots, asOf, facts, caveats, observations)
  return { facts: facts.filter(entry => entry.domain === 'cross-asset'), caveats, observation: observations['cross-asset']! }
}

/** The fact's identity suffix is its window (`${range}-${horizon}`); the rest of the id is internal. */
function factFor(facts: readonly AgentFact[], subject: string, suffix: string) {
  return facts.find(entry => entry.subject === subject && entry.factId.endsWith(`-${suffix}`))
}

function allRanges(): Map<CrossAssetRange, CrossAssetSnapshot> {
  return new Map([['1h', snapshot('1h')], ['24h', snapshot('24h')], ['7d', snapshot('7d')]])
}

describe('projectCrossAsset', () => {
  it('reports every price window the verifier checks, plus the relative return, as comparable', () => {
    const { facts, observation } = project(allRanges())

    const priceMetrics = facts.filter(entry => entry.metric.startsWith('price-return'))
    // One fact per window per asset, plus the index row's 24h close: nine in total, all comparable.
    expect(priceMetrics).toHaveLength(9)
    for (const asset of ['BTC', 'ETH', 'USTEC'] as const) {
      const windows = asset === 'USTEC' ? ['24h-24h'] : ['1h-15m', '24h-2h', '24h-24h', '7d-3d']
      for (const suffix of windows) expect(factFor(priceMetrics, asset, suffix), `${asset} ${suffix}`).toBeDefined()
    }
    expect(priceMetrics.every(entry => entry.comparability === 'comparable' && entry.unit === '%')).toBe(true)
    // The window must be readable from the fact itself, not only from its internal id.
    expect(priceMetrics.map(entry => entry.metric).sort()).toEqual([
      'price-return-15m', 'price-return-15m', 'price-return-24h', 'price-return-24h', 'price-return-24h',
      'price-return-2h', 'price-return-2h', 'price-return-3d', 'price-return-3d'
    ])
    // 2h reads 24 points back on a 0.1/step curve; 15m reads 3 points; the 24h close is the metric.
    expect(factFor(facts, 'BTC', '24h-2h')?.value).toBeCloseTo(2.4)
    expect(factFor(facts, 'BTC', '1h-15m')?.value).toBeCloseTo(0.3)
    expect(factFor(facts, 'BTC', '24h-24h')?.value).toBe(2)
    expect(observation).toMatchObject({ queryState: 'available' })
  })

  it('derives the relative return exactly as the verifier does, and never inverted', () => {
    const { facts } = project(allRanges())
    const relative = facts.find(entry => entry.metric.startsWith('relative-return'))

    // BTC 2h (+2.4 over 24 points at 0.1) minus ETH 2h (+1.2 at 0.05) = +1.2, i.e. BTC stronger.
    expect(relative).toMatchObject({ subject: 'btc-vs-eth', unit: '%', comparability: 'comparable' })
    expect(relative?.value).toBeCloseTo(1.2)
  })

  it('refuses to compare a number whose coverage is incomplete', () => {
    const incomplete = snapshot('24h', {
      historyCoverage: { btc: { count: 288, expectedCount: 289, complete: false }, eth: { count: 289, expectedCount: 289, complete: true }, index: { count: 289, expectedCount: 289, complete: true } }
    })
    const { facts, caveats } = project(new Map([['24h', incomplete]]))

    expect(factFor(facts, 'BTC', '24h-2h')?.comparability).toBe('not-comparable')
    expect(factFor(facts, 'ETH', '24h-2h')?.comparability).toBe('comparable')
    // The relative return mixes both sides, so one incomplete leg makes it not comparable.
    expect(facts.find(entry => entry.metric.startsWith('relative-return'))?.comparability).toBe('not-comparable')
    expect([...caveats]).toContain('not-comparable')
  })

  it('names the real index as the subject of its fact and states the session limit that comes with it', () => {
    const { facts, caveats } = project(allRanges())

    const indexFact = factFor(facts, 'USTEC', '24h-24h')
    expect(indexFact).toMatchObject({ sourceId: 'realmarketapi-market', comparability: 'comparable' })
    // The instrument cannot explain a move made while its market was shut, and the caveat says so
    // rather than leaving the model to discover it from a flat curve.
    expect([...caveats]).toContain('us-cash-session')
    expect([...caveats]).not.toContain('tokenized-index-proxy')
  })

  it('names the tokenised proxy as the subject when it is the leg that answered the row', () => {
    const { facts, caveats } = project(new Map([['24h', snapshot('24h', { indexSource: 'proxy' })]]))
    const indexFact = factFor(facts, 'QQQUSDT', '24h-24h')

    expect(indexFact).toMatchObject({ sourceId: 'binance-futures-positioning' })
    // The caveat is what keeps a synthetic perpetual from being read as the standard index.
    expect([...caveats]).toContain('tokenized-index-proxy')
    expect([...caveats]).not.toContain('us-cash-session')
  })

  it('contributes no index fact at all when neither leg answered the row', () => {
    const { facts } = project(new Map([['24h', snapshot('24h', { indexSource: 'unavailable' })]]))
    expect(facts.some(entry => entry.subject === 'USTEC' || entry.subject === 'QQQUSDT')).toBe(false)
  })

  it('leaves the domain not-comparable when nothing usable was read, instead of throwing', () => {
    const { facts, caveats, observation } = project(new Map())
    expect(facts).toEqual([])
    expect(observation).toMatchObject({ queryState: 'not-comparable', factCount: 0 })
    expect([...caveats]).toContain('not-comparable')
  })

  it('ignores a snapshot that is not a frozen observation at this as-of', () => {
    const future = snapshot('1h', { asOf: '2026-10-13T16:00:00.000Z' })
    const current = snapshot('1h', { mode: 'current' })
    const { facts, observation } = project(new Map([['1h', future], ['24h', current]]))
    expect(facts).toEqual([])
    expect(observation).toMatchObject({ queryState: 'not-comparable' })
  })

  it('covers exactly the windows the shared policy names, and nothing else', () => {
    const { facts } = project(allRanges())
    const suffixes = new Set(facts.filter(entry => entry.metric.startsWith('price-return') && entry.subject === 'BTC')
      .map(entry => `${crossAssetAnalysisWindowPolicy.priceReturns.find(window => entry.factId.endsWith(`${window.range}-${window.horizon}`))?.horizon}`))
    expect([...suffixes].sort()).toEqual([...crossAssetAnalysisWindowPolicy.priceReturns.map(window => window.horizon)].sort())
    // No fact may cite a window the policy does not define (a stray horizon would look checkable).
    for (const entry of facts) {
      const suffix = crossAssetAnalysisWindowPolicy.priceReturns.some(window => entry.factId.endsWith(`${window.range}-${window.horizon}`) || entry.factId.endsWith(`${crossAssetAnalysisWindowPolicy.relativeReturn.range}-${crossAssetAnalysisWindowPolicy.relativeReturn.horizon}`))
      expect(suffix, entry.factId).toBe(true)
    }
  })
})
