import { describe, expect, it } from 'vitest'

import { MARKET_ANALYSIS_CONTEXT_CAVEATS, type AgentFact } from '../../../contracts/marketAnalysisContracts'
import {
  macroRatesSnapshotPublicPolicy,
  type MacroRatesReading
} from '../../../contracts/macro/macroRatesSnapshotContracts'
import type { MacroRatesSnapshot } from '../macro-rates/macroRatesSnapshotQuery'
import {
  MACRO_RATES_FACT_METRICS,
  MACRO_RATES_READ_CAVEAT,
  projectMacroRates
} from './macroRatesFactProjection'
import type { MarketAnalysisDomainObservation } from './domainObservationMerge'

const AS_OF = '2026-10-14T12:00:00.000Z'
const SERIES = macroRatesSnapshotPublicPolicy.series

/** The four readings the dashboard's daily block renders, as the query returns them. */
function readings(): MacroRatesReading[] {
  return [
    { seriesId: SERIES.us10y, metricKey: 'US_10Y_YIELD', actual: 4.15, previous: 4.13, period: '2026-10-13' },
    { seriesId: SERIES.realRate, metricKey: 'US_REAL_YIELD_10Y', actual: 1.85, previous: 1.82, period: '2026-10-13' },
    { seriesId: SERIES.us2y, metricKey: 'US_2Y_YIELD', actual: 4.0, period: '2026-10-13' },
    { seriesId: SERIES.breakevenInflation, metricKey: 'US_10Y_BREAKEVEN_INFLATION', actual: 2.3, period: '2026-10-13' }
  ]
}

function snapshot(overrides: Partial<Extract<MacroRatesSnapshot, { state: 'available' | 'empty' }>> = {}): MacroRatesSnapshot {
  return { state: 'available', asOf: AS_OF, readings: readings(), caveats: [MACRO_RATES_READ_CAVEAT], ...overrides }
}

function project(input: MacroRatesSnapshot | undefined, asOf = AS_OF) {
  const facts: AgentFact[] = []
  const caveats = new Set<string>()
  const observations: Partial<Record<'macro', MarketAnalysisDomainObservation>> = {}
  projectMacroRates(input, asOf, facts, caveats, observations)
  return { facts, caveats, observation: observations.macro! }
}

function metric(facts: readonly AgentFact[], name: string): AgentFact | undefined {
  return facts.find(entry => entry.metric === name)
}

describe('projectMacroRates', () => {
  it('states each level as a percent with its observation date and the daily-close caveat', () => {
    const { facts, caveats, observation } = project(snapshot())

    expect(metric(facts, MACRO_RATES_FACT_METRICS.us10y)).toMatchObject({
      domain: 'macro', subject: 'us-treasury', value: 4.15, unit: '%',
      sourceId: 'fred-rates-liquidity', observedAt: '2026-10-13T00:00:00.000Z', asOf: AS_OF
    })
    expect(metric(facts, MACRO_RATES_FACT_METRICS.realRate)).toMatchObject({ value: 1.85, unit: '%' })
    expect(metric(facts, MACRO_RATES_FACT_METRICS.us2y)).toMatchObject({ value: 4, unit: '%' })
    expect(metric(facts, MACRO_RATES_FACT_METRICS.breakevenInflation)).toMatchObject({ value: 2.3, unit: '%' })
    // "截至 2026-10-13" has to be readable from the fact itself, not only from the snapshot around it.
    expect(metric(facts, MACRO_RATES_FACT_METRICS.us10y)?.observedAt).toContain('2026-10-13')
    expect([...caveats]).toContain(MACRO_RATES_READ_CAVEAT)
    expect(observation.caveats).toContain(MACRO_RATES_READ_CAVEAT)
    expect(observation).toMatchObject({ queryState: 'available', freshness: 'fresh' })
  })

  it('states a day-over-day change in basis points, never as a percent', () => {
    const { facts } = project(snapshot())

    const change = metric(facts, `${MACRO_RATES_FACT_METRICS.us10y}-change-1d`)
    expect(change).toMatchObject({ unit: 'bp' })
    // 4.15 - 4.13 is 2 basis points, not 0.02 percent and not 2 percent.
    expect(change?.value).toBe(2)
    expect(metric(facts, `${MACRO_RATES_FACT_METRICS.us2y}-change-1d`)).toBeUndefined()
  })

  it('states the 10Y-2Y term spread in basis points only when both legs share one trading day', () => {
    const sameDay = project(snapshot())
    expect(metric(sameDay.facts, MACRO_RATES_FACT_METRICS.termSpread10y2y)).toMatchObject({ unit: 'bp' })
    // Rounded to the basis point the panel prints, not the raw float product (15.000000000000036).
    expect(metric(sameDay.facts, MACRO_RATES_FACT_METRICS.termSpread10y2y)?.value).toBe(15)

    const twoDays = project(snapshot({
      readings: readings().map(reading => reading.seriesId === SERIES.us2y ? { ...reading, period: '2026-10-10' } : reading)
    }))
    expect(metric(twoDays.facts, MACRO_RATES_FACT_METRICS.termSpread10y2y)).toBeUndefined()
    expect([...twoDays.caveats]).toContain(MARKET_ANALYSIS_CONTEXT_CAVEATS.macroRatesMixedPeriods)
    // The two legs themselves are still facts; only their difference is withheld.
    expect(metric(twoDays.facts, MACRO_RATES_FACT_METRICS.us10y)).toBeDefined()
    expect(metric(twoDays.facts, MACRO_RATES_FACT_METRICS.us2y)).toBeDefined()
  })

  it('produces no fact at all for a series the query could not answer', () => {
    const { facts } = project(snapshot({
      readings: readings().filter(reading => reading.seriesId !== SERIES.breakevenInflation)
    }))

    expect(metric(facts, MACRO_RATES_FACT_METRICS.breakevenInflation)).toBeUndefined()
    expect(facts.some(entry => entry.value === 0)).toBe(false)
  })

  it('never turns FRED\'s "." missing marker into a zero', () => {
    // The query drops a level that fails its own bounds, so the reading arrives as `.` only when a
    // caller hands the projection a store row directly. It must be refused rather than read as 0.
    const dotted = { seriesId: SERIES.us10y, metricKey: 'US_10Y_YIELD', actual: '.', period: '2026-10-13' }
    const { facts } = project(snapshot({ readings: [dotted as unknown as MacroRatesReading] }))

    expect(metric(facts, MACRO_RATES_FACT_METRICS.us10y)).toBeUndefined()
    expect(facts).toEqual([])
  })

  it('drops a reading whose trading day the analysis clock has not reached', () => {
    const { facts, observation } = project(snapshot({
      readings: [{ seriesId: SERIES.us10y, metricKey: 'US_10Y_YIELD', actual: 4.15, period: '2026-10-20' }]
    }))

    expect(facts).toEqual([])
    expect(observation.queryState).toBe('empty')
  })

  it('reports an unwired or empty snapshot as a gap, never as a flat market', () => {
    const unwired = project(undefined)
    expect(unwired.facts).toEqual([])
    expect(unwired.observation).toMatchObject({ queryState: 'unavailable', freshness: 'unavailable' })

    const empty = project({ state: 'empty', asOf: AS_OF, readings: [], caveats: [MACRO_RATES_READ_CAVEAT] })
    expect(empty.facts).toEqual([])
    expect(empty.observation.queryState).toBe('empty')
    expect(empty.observation.caveats).toContain(MARKET_ANALYSIS_CONTEXT_CAVEATS.queryEmpty)
  })
})
