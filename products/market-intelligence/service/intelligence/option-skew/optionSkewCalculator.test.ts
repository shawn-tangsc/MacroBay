import { describe, expect, it } from 'vitest'

import { buildOptionSkewChainFixture, OPTION_SKEW_FIXTURE_NOW_MS } from './optionSkewChainFixture'
import { computeOptionSkew } from './optionSkewCalculator'

/**
 * The 口径 in the design (§4) read off a synthetic chain. The expected numbers were produced by an
 * independent implementation of the same spec (Black-76 at a zero rate, 25Δ interpolation inside
 * each expiry, total-variance interpolation to 30 days), not by this module. Sample data — not a
 * real Deribit reading.
 */
const EXPECTED = { putIv25: 62.7, callIv25: 56.0, riskReversal: 6.7 } as const

function compute(fixture = buildOptionSkewChainFixture()) {
  return computeOptionSkew({ ...fixture, nowMs: OPTION_SKEW_FIXTURE_NOW_MS })
}

describe('computeOptionSkew', () => {
  it('reads the two 25Δ legs and the 30-day risk reversal', () => {
    const result = compute()
    expect(result.state).toBe('computed')
    if (result.state !== 'computed') return
    expect(result.legs.putIv25).toBe(EXPECTED.putIv25)
    expect(result.legs.callIv25).toBe(EXPECTED.callIv25)
    expect(result.legs.riskReversal).toBe(EXPECTED.riskReversal)
    expect(result.legs.underlyingPrice).toBe(90_000)
  })

  it('reports the two expiries that bracket 30 days', () => {
    const result = compute()
    if (result.state !== 'computed') throw new Error('expected a computed point')
    expect(result.legs.expiries).toEqual([
      new Date(OPTION_SKEW_FIXTURE_NOW_MS + 25 * 86_400_000).toISOString(),
      new Date(OPTION_SKEW_FIXTURE_NOW_MS + 40 * 86_400_000).toISOString()
    ])
  })

  it('keeps one decimal on every printed number', () => {
    const result = compute()
    if (result.state !== 'computed') throw new Error('expected a computed point')
    for (const value of [result.legs.putIv25, result.legs.callIv25, result.legs.riskReversal]) {
      expect(Math.round(value * 10) / 10).toBe(value)
    }
  })

  it('uses an expiry that sits exactly on 30 days as it stands', () => {
    const fixture = buildOptionSkewChainFixture({ expiriesInDays: [30], baseVols: [52] })
    const result = compute(fixture)
    if (result.state !== 'computed') throw new Error('expected a computed point')
    const iso = new Date(OPTION_SKEW_FIXTURE_NOW_MS + 30 * 86_400_000).toISOString()
    expect(result.legs.expiries).toEqual([iso, iso])
  })

  it('ignores an expiry closer than two days', () => {
    // Without the two-day floor the one-day expiry would become the lower bracket and move the
    // interpolated leg; the result must equal the clean chain's.
    const withNearExpiry = buildOptionSkewChainFixture({ expiriesInDays: [1, 25, 40], baseVols: [70, 52, 50] })
    expect(compute(withNearExpiry)).toEqual(compute())
  })

  it('fails when no expiry brackets 30 days', () => {
    const tooNear = compute(buildOptionSkewChainFixture({ expiriesInDays: [25], baseVols: [52] }))
    expect(tooNear).toEqual({ state: 'failed', failureCode: 'no-bracketing-expiry' })
    const tooFar = compute(buildOptionSkewChainFixture({ expiriesInDays: [40], baseVols: [50] }))
    expect(tooFar).toEqual({ state: 'failed', failureCode: 'no-bracketing-expiry' })
  })

  it('drops a contract nobody holds', () => {
    // Both strikes that bracket the 25Δ put carry no open interest: a leg that remains would have
    // to be invented, so the expiry is unusable.
    const fixture = buildOptionSkewChainFixture()
    const quotes = fixture.quotes.map((quote) => (
      quote.instrumentName.endsWith('-80000-P') || quote.instrumentName.endsWith('-85000-P')
        ? { ...quote, openInterest: 0 }
        : quote
    ))
    expect(computeOptionSkew({ ...fixture, quotes, nowMs: OPTION_SKEW_FIXTURE_NOW_MS }))
      .toEqual({ state: 'failed', failureCode: 'no-bracketing-expiry' })
  })

  it('drops a one-sided quote', () => {
    // Every out-of-the-money call loses its bid: the call wing is gone, and the leg may not be
    // reconstructed from a wide bracket on the remaining quotes.
    const fixture = buildOptionSkewChainFixture()
    const quotes = fixture.quotes.map((quote) => {
      const parts = quote.instrumentName.split('-')
      const isOtmCall = parts.at(-1) === 'C' && Number(parts[4]) > 90_000
      return isOtmCall ? { ...quote, bidPrice: 0 } : quote
    })
    expect(computeOptionSkew({ ...fixture, quotes, nowMs: OPTION_SKEW_FIXTURE_NOW_MS }))
      .toEqual({ state: 'failed', failureCode: 'no-bracketing-expiry' })
  })

  it('needs a forward price per expiry', () => {
    const fixture = buildOptionSkewChainFixture()
    const quotes = fixture.quotes.map((quote) => {
      const { underlyingPrice: _dropped, ...rest } = quote
      return rest
    })
    expect(computeOptionSkew({ ...fixture, quotes, nowMs: OPTION_SKEW_FIXTURE_NOW_MS }))
      .toEqual({ state: 'failed', failureCode: 'no-bracketing-expiry' })
  })

  it('does not let a deep wing take part in the interpolation', () => {
    const fixture = buildOptionSkewChainFixture()
    const instruments = [...fixture.instruments]
    const quotes = [...fixture.quotes]
    const expiryMs = OPTION_SKEW_FIXTURE_NOW_MS + 25 * 86_400_000
    const name = 'BTC-extreme-40000-P'
    instruments.push({ instrumentName: name, expiryMs, strike: 40_000, optionType: 'put' })
    quotes.push({ instrumentName: name, markIv: 400, bidPrice: 1, askPrice: 2, openInterest: 10, underlyingPrice: 90_000 })
    expect(computeOptionSkew({ ...fixture, instruments, quotes, nowMs: OPTION_SKEW_FIXTURE_NOW_MS }))
      .toEqual(compute())
  })

  it('does not invent a leg when a side has no usable quote', () => {
    // A zero mark_iv makes sigma useless: every candidate on that wing is dropped, so the day
    // cannot be computed — and it must not be written as a zero.
    const fixture = buildOptionSkewChainFixture()
    const quotes = fixture.quotes.map((quote) => (quote.instrumentName.endsWith('-P') ? { ...quote, markIv: 0 } : quote))
    expect(computeOptionSkew({ ...fixture, quotes, nowMs: OPTION_SKEW_FIXTURE_NOW_MS }))
      .toEqual({ state: 'failed', failureCode: 'no-bracketing-expiry' })
  })
})