import { describe, expect, it } from 'vitest'
import { realMarketApiPolicy } from './realMarketApiPolicy'
import { macroMarketBackfillBars } from './macroMarketReturns'
import {
  parseProviderInstant, parseRealMarketApiCandles, parseRealMarketApiPrice, realMarketApiCandleUrl, realMarketApiFailureCode,
  realMarketApiPriceUrl
} from './realMarketApiTimeSeries'
import { realMarketApiCandleResponse, realMarketApiFixtureInstants, realMarketApiPriceResponse } from './realMarketApiResponseFixtures'

const key = `${'a1'.repeat(16)}`
const at = (hour: number, minute: number) => Date.UTC(2026, 9, 14, hour, minute)

describe('the real dollar index URL builders', () => {
  it('names the provider parameters the live endpoint actually reads', () => {
    const price = new URL(realMarketApiPriceUrl(key))
    expect(price.origin + price.pathname).toBe('https://api.realmarketapi.com/api/v1/price')
    expect(price.searchParams.get('symbolCode')).toBe('DXY')
    expect(price.searchParams.get('timeFrame')).toBe('M5')
    expect(price.searchParams.get('apiKey')).toBe(key)
    // Not `symbol`/`timeframe`: the provider answers those with its own error, not with a price.
    expect(price.searchParams.has('symbol')).toBe(false)
    expect(price.searchParams.has('timeframe')).toBe(false)

    const candle = new URL(realMarketApiCandleUrl(key))
    expect(candle.origin + candle.pathname).toBe('https://api.realmarketapi.com/api/v1/candle')
    expect(candle.searchParams.get('symbolCode')).toBe('DXY')
    expect(candle.searchParams.get('timeFrame')).toBe('M5')
    expect(candle.searchParams.get('limit')).toBe(String(macroMarketBackfillBars(5 * 60_000)))
  })
})

describe('the real dollar index parser', () => {
  it('reads the captured price answer as the number and the instant it published', () => {
    const parsed = parseRealMarketApiPrice(realMarketApiPriceResponse)
    expect(parsed).toEqual({ state: 'available', points: [{ atMs: realMarketApiFixtureInstants.price, value: 102.237 }] })
    // The fields really are JSON numbers and the instant really is ISO UTC: nothing is coerced here.
    expect(typeof (realMarketApiPriceResponse.closePrice)).toBe('number')
    expect(new Date(realMarketApiFixtureInstants.price).toISOString()).toBe(realMarketApiPriceResponse.openTime)
  })

  it('refuses a price it cannot read rather than repairing one', () => {
    const base = realMarketApiPriceResponse
    const broken: readonly unknown[] = [
      undefined, null, [], 'DXY', 102.237,
      { ...base, closePrice: undefined }, { ...base, closePrice: '102.237' }, { ...base, closePrice: Number.NaN },
      { ...base, closePrice: 0 }, { ...base, closePrice: -1 },
      { ...base, openTime: undefined }, { ...base, openTime: '2026-10-14 11:00:00' }, { ...base, openTime: 'not-a-date' },
      { ...base, openTime: '2026-10-14T11:00:00Z' }, { ...base, openTime: 1792000000000 },
      // Another symbol's price is not this series, whatever the numbers say.
      { ...base, symbolCode: 'EURUSD' }, { ...base, symbolCode: undefined }
    ]
    for (const payload of broken) {
      expect(parseRealMarketApiPrice(payload)).toEqual({ state: 'unavailable', failureCode: 'response-invalid' })
    }
  })

  it('maps the provider status onto the shared failure vocabulary', () => {
    expect(realMarketApiFailureCode(401)).toBe('credential-rejected')
    expect(realMarketApiFailureCode(403)).toBe('plan-restricted')
    expect(realMarketApiFailureCode(429)).toBe('rate-limited')
    expect(realMarketApiFailureCode(400)).toBe('response-invalid')
    expect(realMarketApiFailureCode(500)).toBe('response-invalid')
    // A rejection reported in the body still travels with its status.
    expect(parseRealMarketApiPrice({ message: 'unauthorized' }, 401)).toEqual({ state: 'unavailable', failureCode: 'credential-rejected' })
  })

  it('reads the captured candle page in ascending order with no duplicate instant', () => {
    const parsed = parseRealMarketApiCandles(realMarketApiCandleResponse)
    expect(parsed.state).toBe('available')
    if (parsed.state !== 'available') throw new Error('expected candles')
    expect(parsed.points.map(point => point.atMs)).toEqual([at(11, 0), at(11, 15), at(11, 30)])
    expect(parsed.points.map(point => point.value)).toEqual([102.246, 102.24, 102.236])
    // The provider answers newest first; the store reads oldest first, and the parser is where that
    // reversal happens so no caller has to remember it.
    expect(realMarketApiCandleResponse.data.map(row => row.openTime)).toEqual([
      '2026-10-14T11:30:00.000Z', '2026-10-14T11:15:00.000Z', '2026-10-14T11:00:00.000Z'
    ])
  })

  it('keeps the first answer for an instant the provider repeats', () => {
    const rows = [
      ...realMarketApiCandleResponse.data,
      { ...realMarketApiCandleResponse.data[0], closePrice: 999, openTime: '2026-10-14T11:30:00.000Z' },
      { openPrice: 1, closePrice: 1, openTime: '2026-10-14T11:30:00.000Z' }
    ]
    const parsed = parseRealMarketApiCandles({ data: rows })
    if (parsed.state !== 'available') throw new Error('expected candles')
    expect(parsed.points).toHaveLength(3)
    expect(parsed.points.at(-1)).toEqual({ atMs: at(11, 30), value: 102.236 })
  })

  it('drops a bad bar and keeps the good ones, and calls an unusable page unusable', () => {
    const good = realMarketApiCandleResponse.data[2]
    const parsed = parseRealMarketApiCandles({
      data: [
        { ...good, openTime: '2026-10-14T11:15:00.000Z' },
        { ...good, closePrice: '102.246', openTime: '2026-10-14T11:00:00.000Z' },
        { ...good, openTime: 'yesterday' },
        { ...good, symbolCode: 'EURUSD', openTime: '2026-10-14T10:45:00.000Z' },
        null, 'row', 42
      ]
    })
    expect(parsed).toEqual({ state: 'available', points: [{ atMs: at(11, 15), value: 102.246 }] })

    // An empty or unreadable page is a failure, not an empty series: "nothing arrived" and "nothing
    // changed" must never be the same answer.
    for (const payload of [
      { data: [] }, { data: [{ ...good, openTime: 'yesterday' }] }, { data: 'nope' }, {}, null, [], 'x',
      { data: [{ ...good, closePrice: null }] }
    ]) {
      expect(parseRealMarketApiCandles(payload)).toEqual({ state: 'unavailable', failureCode: 'response-invalid' })
    }
    expect(parseRealMarketApiCandles({ data: [] }, 429)).toEqual({ state: 'unavailable', failureCode: 'rate-limited' })
  })

  it('accepts only a canonical UTC instant', () => {
    expect(parseProviderInstant('2026-10-14T11:00:00.000Z')).toBe(at(11, 0))
    for (const value of [undefined, null, 1792000000000, '', '2026-10-14', '2026-10-14T11:00:00Z', '2026-13-40T00:00:00.000Z']) {
      expect(parseProviderInstant(value)).toBeUndefined()
    }
  })

  it('collects and backfills five-minute bars for both instruments this source answers', () => {
    expect(realMarketApiPolicy.intervalMs).toBe(5 * 60_000)
    expect(realMarketApiPolicy.latestTimeFrame).toBe('M5')
    // Gold moved here from the basket source, so the backfill has to cover it too — and on the tick's
    // own five-minute bar, because a fifteen-minute backfill left the two series on two grids.
    expect(realMarketApiPolicy.backfillTimeFrame).toBe('M5')
    expect(realMarketApiPolicy.backfillLimit).toBe(macroMarketBackfillBars(5 * 60_000))
    expect(realMarketApiPolicy.symbols.map(entry => entry.symbolCode)).toEqual(['DXY', 'XAUUSD'])
    expect(realMarketApiPolicy.symbols.map(entry => realMarketApiPolicy.series[entry.series]))
      .toEqual(['dxy-real', 'xau-usd'])
  })
})
