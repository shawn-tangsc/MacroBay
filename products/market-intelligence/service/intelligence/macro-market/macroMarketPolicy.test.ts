import { describe, expect, it } from 'vitest'
import { dollarIndexFormula, macroMarketPolicy } from './macroMarketPolicy'
import { dollarIndexSeriesId, missingDollarIndexTerms, synthesizeDollarIndex } from './dollarIndexSynthesis'
import { macroMarketDailyCredits, macroMarketRequestPlan } from './macroMarketRequestPlan'
import { parseProviderDatetime, parseTimeSeries, timeSeriesUrl, timeSeriesFailureCode } from './twelveDataTimeSeries'

const basket = { 'EUR/USD': 1.12, 'USD/JPY': 158.3, 'GBP/USD': 1.3266, 'USD/CAD': 1.4202, 'USD/SEK': 9.954, 'USD/CHF': 0.8324 }

describe('the synthetic dollar index', () => {
  it('applies the published ICE weights, and a weaker euro raises the index', () => {
    const base = synthesizeDollarIndex(basket)!
    const weakerEuro = synthesizeDollarIndex({ ...basket, 'EUR/USD': 1.09 })!
    // Checked against an independent computation of ICE's published formula over the same inputs
    // (and the same formula with real-world magnitudes lands in the 95–110 range the index lives in).
    expect(base).toBeCloseTo(102.1644745134762, 6)
    expect(weakerEuro).toBeGreaterThan(base)
    expect(dollarIndexFormula.constant).toBe(50.14348112)
  })

  it('refuses to publish an index built from part of the basket, and says which term is missing', () => {
    const partial = { ...basket } as Record<string, number | undefined>
    delete partial['USD/SEK']
    expect(synthesizeDollarIndex(partial)).toBeUndefined()
    expect(missingDollarIndexTerms(partial)).toEqual(['USD/SEK'])
    expect(missingDollarIndexTerms({ ...basket, 'USD/CHF': 0 })).toEqual(['USD/CHF'])
    expect(dollarIndexSeriesId).toBe('dxy-synthetic')
  })
})

describe('the tick plan keeps the credit budget', () => {
  const at = (minute: number, second = 0) => Date.UTC(2026, 9, 14, 6, minute, second)
  const fresh = {}
  it('fetches the basket first however the job happens to be phased, then the extras', () => {
    // No history: a restart must fetch, not wait for a boundary the trigger may never reach.
    expect(macroMarketRequestPlan(at(7), fresh)).toMatchObject({ kind: 'dollar-basket', credits: 6 })
    expect(macroMarketRequestPlan(at(7)).symbols).toEqual([...macroMarketPolicy.tickSymbols])
    // Seven minutes later the basket is not due again; the extras are.
    expect(macroMarketRequestPlan(at(14), { basketAtMs: at(7) })).toMatchObject({ kind: 'extras', credits: 2 })
    // Both collected recently: this tick costs nothing.
    expect(macroMarketRequestPlan(at(14), { basketAtMs: at(7), extrasAtMs: at(9) })).toMatchObject({ kind: 'idle', credits: 0 })
    // Fifteen minutes on, the basket is due again.
    expect(macroMarketRequestPlan(at(22), { basketAtMs: at(7), extrasAtMs: at(9) })).toMatchObject({ kind: 'dollar-basket', credits: 6 })
  })

  it('a restart looks immediately, taking whichever series is staler', () => {
    const now = at(22)
    // Nothing collected yet: the basket is the one to take.
    expect(macroMarketRequestPlan(now, {}, { force: true })).toMatchObject({ kind: 'dollar-basket', credits: 6 })
    // The extras last ran longer ago than the basket, so the forced look takes them.
    expect(macroMarketRequestPlan(now, { basketAtMs: at(21), extrasAtMs: at(0) }, { force: true })).toMatchObject({ kind: 'extras', credits: 2 })
    // Without the flag the cadence still rules.
    expect(macroMarketRequestPlan(now, { basketAtMs: at(21), extrasAtMs: at(0) })).toMatchObject({ kind: 'idle', credits: 0 })
  })

  it('costs less than the free tier allows per day and never more than it allows per minute', () => {
    expect(macroMarketDailyCredits()).toBeLessThan(macroMarketPolicy.creditBudget.perDay)
    expect(macroMarketPolicy.tickSymbols.length).toBeLessThanOrEqual(macroMarketPolicy.creditBudget.perMinute)
    expect(macroMarketPolicy.halfCadenceSymbols.length).toBeLessThanOrEqual(macroMarketPolicy.creditBudget.perMinute)
  })
})

describe('the provider payload', () => {
  const single = {
    meta: { symbol: 'XAU/USD', interval: '15min' },
    values: [{ datetime: '2026-10-14 06:15:00', open: '4160.22136', high: '4162.50416', low: '4159.21709', close: '4159.73383' }],
    status: 'ok'
  }
  const multi = {
    'EUR/USD': { meta: { symbol: 'EUR/USD' }, values: [{ datetime: '2026-10-14 06:00:00', open: '1.12', high: '1.121', low: '1.119', close: '1.12024' }], status: 'ok' },
    'USD/JPY': { meta: { symbol: 'USD/JPY' }, values: [{ datetime: '2026-10-14 06:00:00', open: '158.2', high: '158.4', low: '158.1', close: '158.30893' }], status: 'ok' }
  }

  it('reads both shapes, in UTC, and pins the request to UTC as well', () => {
    expect(parseTimeSeries(single)).toEqual({ state: 'available', bars: [{ symbol: 'XAU/USD', atMs: Date.UTC(2026, 9, 14, 6, 15), open: '4160.22136', high: '4162.50416', low: '4159.21709', close: '4159.73383' }] })
    const parsed = parseTimeSeries(multi)
    expect(parsed.state).toBe('available')
    if (parsed.state !== 'available') return
    expect(parsed.bars.map(bar => bar.symbol)).toEqual(['EUR/USD', 'USD/JPY'])
    expect(parsed.bars[0]!.atMs).toBe(Date.UTC(2026, 9, 14, 6, 0))
    expect(timeSeriesUrl(['EUR/USD', 'XAU/USD'], 'k')).toContain('timezone=UTC')
    expect(timeSeriesUrl(['EUR/USD', 'XAU/USD'], 'k')).toContain('interval=15min')
    expect(parseProviderDatetime('2026-10-14 06:00:00')).toBe(Date.UTC(2026, 9, 14, 6, 0))
    expect(parseProviderDatetime('not a time')).toBeUndefined()
  })

  it('classifies the failures the plan cares about instead of calling them all invalid', () => {
    expect(parseTimeSeries({ code: 429, message: 'out of credits', status: 'error' })).toMatchObject({ state: 'unavailable', failureCode: 'rate-limited' })
    expect(parseTimeSeries({ code: 401, message: 'bad key', status: 'error' })).toMatchObject({ failureCode: 'credential-rejected' })
    expect(parseTimeSeries({ code: 403, message: 'upgrade', status: 'error' })).toMatchObject({ failureCode: 'plan-restricted' })
    expect(parseTimeSeries({ code: 404, message: 'no symbol', status: 'error' })).toMatchObject({ failureCode: 'response-invalid' })
    expect(parseTimeSeries({ values: [{ datetime: '2026-10-14 06:07:00', open: '1', high: '1', low: '1', close: '1' }], meta: { symbol: 'X' } }))
      .toMatchObject({ state: 'unavailable', failureCode: 'response-invalid' })
    expect(timeSeriesFailureCode(429, undefined)).toBe('rate-limited')
  })
})
