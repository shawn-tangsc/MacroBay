import { describe, expect, it } from 'vitest'

import { MARKET_ANALYSIS_CONTEXT_CAVEATS, type AgentFact } from '../../../contracts/marketAnalysisContracts'
import type { MacroMarketSnapshotReading } from '../../../contracts/macro/macroMarketSnapshotContracts'
import { macroMarketSnapshotPublicPolicy } from '../../../contracts/macro/macroMarketSnapshotContracts'
import type { MacroMarketSnapshot } from '../macro-market/macroMarketSnapshotQuery'
import {
  MACRO_MARKET_FACT_METRICS,
  MACRO_MARKET_READ_CAVEAT,
  projectMacroMarket
} from './macroMarketFactProjection'
import type { MarketAnalysisDomainObservation } from './domainObservationMerge'

const AS_OF = '2026-09-25T08:30:00.000Z'
const AS_OF_MS = Date.parse(AS_OF)
const SERIES = macroMarketSnapshotPublicPolicy.series

/** A reading shaped exactly like the one `createMacroMarketSnapshotQuery` returns. */
function reading(overrides: Partial<MacroMarketSnapshotReading> & { seriesId: string }): MacroMarketSnapshotReading {
  return {
    level: 100,
    returns: { '15m': 0.1, '1h': 0.2, '24h': 0.4, '7d': 0.3 },
    ...overrides,
    atMs: overrides.atMs ?? AS_OF_MS
  }
}

function dollarReal(overrides: Partial<MacroMarketSnapshotReading> = {}): MacroMarketSnapshotReading {
  return reading({ seriesId: SERIES.dollarIndexReal, level: 102.24, ...overrides })
}

function dollarSynthetic(overrides: Partial<MacroMarketSnapshotReading> = {}): MacroMarketSnapshotReading {
  return reading({ seriesId: SERIES.dollarIndex, level: 101.42, synthetic: true, ...overrides })
}

function gold(overrides: Partial<MacroMarketSnapshotReading> = {}): MacroMarketSnapshotReading {
  return reading({ seriesId: SERIES.gold, level: 4100.5, ...overrides })
}

function snapshot(readings: readonly MacroMarketSnapshotReading[], at = AS_OF): MacroMarketSnapshot {
  return { state: readings.length > 0 ? 'available' : 'empty', asOf: at, readings, caveats: [] }
}

function project(input: MacroMarketSnapshot | undefined, asOf = AS_OF) {
  const facts: AgentFact[] = []
  const caveats = new Set<string>()
  const observations: Partial<Record<'macro', MarketAnalysisDomainObservation>> = {}
  projectMacroMarket(input, asOf, facts, caveats, observations)
  return { facts, caveats, observation: observations.macro! }
}

function metric(facts: readonly AgentFact[], name: string): AgentFact | undefined {
  return facts.find(entry => entry.metric === name)
}

describe('projectMacroMarket', () => {
  it('states the licensed dollar level and every window it can answer, with no synthetic caveat', () => {
    const { facts, caveats, observation } = project(snapshot([dollarReal(), gold()]))

    const level = metric(facts, MACRO_MARKET_FACT_METRICS.dollarIndexLevel)
    expect(level).toMatchObject({
      domain: 'macro', subject: 'usd-index', value: 102.24, unit: 'index-point',
      sourceId: 'twelve-data-market', observedAt: AS_OF, asOf: AS_OF, comparability: 'comparable'
    })
    for (const window of ['15m', '1h', '24h', '7d'] as const) {
      expect(metric(facts, MACRO_MARKET_FACT_METRICS.dollarIndexReturn(window)), window).toMatchObject({
        value: expect.any(Number), unit: '%', sourceId: 'twelve-data-market'
      })
    }
    // A real reading never carries the caveat that says the level is ours.
    expect([...caveats]).not.toContain('synthetic-dollar-index')
    expect(observation.caveats).not.toContain('synthetic-dollar-index')
    expect([...caveats]).toContain(MACRO_MARKET_READ_CAVEAT)
    expect(observation).toMatchObject({ queryState: 'available', freshness: 'fresh' })
  })

  it('labels a synthesised dollar level and carries the synthetic caveat with it', () => {
    const { facts, caveats, observation } = project(snapshot([dollarSynthetic(), gold()]))

    expect(metric(facts, MACRO_MARKET_FACT_METRICS.dollarIndexLevel)).toMatchObject({ value: 101.42, unit: 'index-point' })
    expect(metric(facts, MACRO_MARKET_FACT_METRICS.dollarIndexReturn('24h'))).toBeDefined()
    expect(observation.caveats).toContain('synthetic-dollar-index')
    expect([...caveats]).toContain(MACRO_MARKET_READ_CAVEAT)
    // The fact names its own leg, so a reader can tell the synthesis from the index.
    expect(metric(facts, MACRO_MARKET_FACT_METRICS.dollarIndexLevel)?.factId).toContain('synthetic')
  })

  it('drops a real dollar reading that has aged past its own bound and names the gap as stale', () => {
    const expired = dollarReal({ atMs: AS_OF_MS - macroMarketSnapshotPublicPolicy.dollarIndexFreshnessMs - 1 })
    const { facts, caveats, observation } = project(snapshot([expired, gold()]))

    // The expired level is not restated as current: no dollar fact survives at all.
    expect(metric(facts, MACRO_MARKET_FACT_METRICS.dollarIndexLevel)).toBeUndefined()
    expect(facts.some(entry => entry.subject === 'usd-index')).toBe(false)
    expect([...caveats]).toContain(MARKET_ANALYSIS_CONTEXT_CAVEATS.queryStale)
    expect(observation.caveats).toContain(MARKET_ANALYSIS_CONTEXT_CAVEATS.queryStale)
    // Gold is unaffected and the domain still reports what it does hold.
    expect(metric(facts, MACRO_MARKET_FACT_METRICS.goldPrice)).toBeDefined()
    expect(observation.queryState).toBe('available')
  })

  it('never restates an expired licensed dollar as current, even beside the synthesis', () => {
    const expired = dollarReal({ atMs: AS_OF_MS - macroMarketSnapshotPublicPolicy.dollarIndexFreshnessMs - 1 })
    const { facts, caveats, observation } = project(snapshot([expired, dollarSynthetic(), gold()]))

    // The stale real reading is dropped and the gap is named; the labelled row is not substituted for
    // it, because a licensed reading that stopped arriving is not the same fact as a computed one.
    expect(metric(facts, MACRO_MARKET_FACT_METRICS.dollarIndexLevel)).toBeUndefined()
    expect([...caveats]).toContain(MARKET_ANALYSIS_CONTEXT_CAVEATS.queryStale)
    expect(observation.caveats).toContain(MARKET_ANALYSIS_CONTEXT_CAVEATS.queryStale)
  })

  it('prefers a fresh live gold tick and never reads the stored bar as a second price', () => {
    const tickAt = AS_OF_MS - 5_000
    const { facts } = project(snapshot([dollarReal(), gold({ live: { state: 'live', price: '4144.04708', atMs: tickAt } })]))

    const prices = facts.filter(entry => entry.metric === MACRO_MARKET_FACT_METRICS.goldPrice)
    expect(prices).toHaveLength(1)
    expect(prices[0]).toMatchObject({ value: 4144.04708, unit: 'USD/oz', observedAt: new Date(tickAt).toISOString() })
  })

  it.each([
    ['a stale tick', { state: 'stale' as const, price: '4144.04708', atMs: AS_OF_MS - 120_000 }],
    ['a tick beyond the stream bound', { state: 'live' as const, price: '4144.04708', atMs: AS_OF_MS - 120_000 }],
    ['a tick with no price', { state: 'live' as const, price: '0', atMs: AS_OF_MS - 1_000 }]
  ])('falls back to the stored gold bar for %s', (_label, live) => {
    const { facts } = project(snapshot([dollarReal(), gold({ live })]))

    const prices = facts.filter(entry => entry.metric === MACRO_MARKET_FACT_METRICS.goldPrice)
    expect(prices).toHaveLength(1)
    expect(prices[0]).toMatchObject({ value: 4100.5, observedAt: AS_OF })
  })

  it('refuses a snapshot collected after the analysis boundary instead of trimming it', () => {
    const { facts, caveats, observation } = project(snapshot([dollarReal(), gold()], '2026-09-25T09:00:00.000Z'))

    expect(facts).toEqual([])
    // The gap is named on the domain, which is where the matrix carries it; the context's own caveat
    // set is filled from those domain caveats after every projection has run.
    expect(observation).toMatchObject({ queryState: 'unavailable', freshness: 'unavailable' })
    expect(observation.caveats).toContain(MARKET_ANALYSIS_CONTEXT_CAVEATS.queryUnavailable)
  })

  it('reports an unwired or empty snapshot as a gap, never as a level', () => {
    const unwired = project(undefined)
    expect(unwired.facts).toEqual([])
    expect(unwired.observation.queryState).toBe('unavailable')

    const empty = project(snapshot([]))
    expect(empty.facts).toEqual([])
    expect(empty.observation.queryState).toBe('empty')
    expect([...empty.caveats]).toContain(MARKET_ANALYSIS_CONTEXT_CAVEATS.queryEmpty)
  })

  it('emits no window fact for a window the series cannot answer', () => {
    const { facts } = project(snapshot([dollarReal({ returns: { '15m': 0.1 } })]))

    expect(metric(facts, MACRO_MARKET_FACT_METRICS.dollarIndexReturn('15m'))).toBeDefined()
    expect(metric(facts, MACRO_MARKET_FACT_METRICS.dollarIndexReturn('24h'))).toBeUndefined()
  })
})
