import { describe, expect, it } from 'vitest'
import { goldLiveHeartbeat, goldLivePolicy, goldLivePriceOf, goldLiveSubscription, goldLiveUrl } from './goldLivePolicy'
import { goldRealPrice, goldRealPriceFrame } from './goldLiveTestKit'

describe('the gold live policy', () => {
  it('subscribes to gold and to nothing else', () => {
    // The free tier admits one connection and only trial symbols. A subscription that also named a
    // currency pair would be refused outright, so the payload is pinned to exactly one symbol.
    expect(JSON.parse(goldLiveSubscription())).toEqual({ action: 'subscribe', params: { symbols: 'XAU/USD' } })
    expect(goldLivePolicy.symbol).toBe('XAU/USD')
    expect(goldLivePolicy.seriesId).toBe('xau-usd')
    // The six ICE basket currencies, the offshore yuan and the peg are absent by name and by value.
    for (const symbol of ['EUR/USD', 'USD/JPY', 'GBP/USD', 'USD/CAD', 'USD/SEK', 'USD/CHF', 'USD/CNH', 'USDT/USD']) {
      expect(goldLiveSubscription()).not.toContain(symbol)
    }
    expect(goldLiveSubscription().match(/symbols/g)).toHaveLength(1)
  })

  it('builds the documented endpoint and keeps the key out of the message body', () => {
    const url = goldLiveUrl('key with/slash&=')
    expect(url.startsWith('wss://ws.twelvedata.com/v1/quotes/price?apikey=')).toBe(true)
    // The key is encoded into the query, never concatenated raw and never placed in a subscription.
    expect(url).toBe('wss://ws.twelvedata.com/v1/quotes/price?apikey=key%20with%2Fslash%26%3D')
    expect(goldLiveSubscription()).not.toContain('apikey')
    expect(goldLiveSubscription()).not.toContain('key with')
  })

  it('carries a bounded backoff ladder that grows and then flattens', () => {
    const delays = goldLivePolicy.reconnect.delaysMs
    expect(delays.length).toBeGreaterThanOrEqual(3)
    expect([...delays]).toEqual([...delays].sort((left, right) => left - right))
    expect(delays[0]).toBeGreaterThan(0)
    expect(delays.at(-1)).toBeLessThanOrEqual(60_000)
    expect(goldLivePolicy.reconnect.jitterRatio).toBeGreaterThan(0)
    expect(goldLivePolicy.maxPriceLength).toBeGreaterThan(0)
    expect(goldLivePolicy.freshnessMs).toBeGreaterThan(0)
  })

  it('keeps the keepalive inside the provider\'s ten-second idle window, and the frame credential-free', () => {
    // The provider closes a silent socket after about ten seconds. The interval has to be strictly
    // under that with room for a late timer, or the keepalive arrives after the close it prevents.
    const interval = goldLivePolicy.heartbeat.intervalMs
    expect(interval).toBeGreaterThan(0)
    expect(interval).toBeLessThanOrEqual(10_000)
    // The frame is data, not logic: one frozen action, byte-identical on every beat.
    expect(goldLivePolicy.heartbeat.frame).toEqual({ action: 'heartbeat' })
    expect(Object.isFrozen(goldLivePolicy.heartbeat.frame)).toBe(true)
    expect(Object.isFrozen(goldLivePolicy.heartbeat)).toBe(true)
    expect(goldLiveHeartbeat()).toBe('{"action":"heartbeat"}')
    expect(goldLiveHeartbeat()).toBe(goldLiveHeartbeat())
    // The key lives in the URL, so no frame may ever carry it.
    expect(goldLiveHeartbeat()).not.toContain('apikey')
    expect(goldLiveHeartbeat()).not.toContain(goldLiveUrl('secret-key'))
    expect(Object.keys(JSON.parse(goldLiveHeartbeat()) as object)).toEqual(['action'])
  })

  // The price rule, pinned on its own: the socket and the snapshot both read it from here, so a
  // change that would silently drop the provider's frames has to fail in this file first.
  describe('the one admitted price shape', () => {
    it('normalises the provider\'s numeric price from the real frame into the canonical decimal string', () => {
      const frame = JSON.parse(goldRealPriceFrame) as { price: unknown }
      expect(typeof frame.price).toBe('number')
      expect(goldLivePriceOf(frame.price)).toBe(goldRealPrice)
      expect(goldLivePriceOf(frame.price)).toBe('4144.04708')
    })

    it('admits both transport shapes of the same figure, and writes both the same way', () => {
      for (const value of [4144.04708, '4144.04708', 1900, '1900', 0.5, '0.5']) {
        expect(goldLivePriceOf(value)).toBe(typeof value === 'number' ? String(value) : value)
      }
      // An integer number is a decimal too: `String` never adds a fraction part, and none is needed.
      expect(goldLivePriceOf(1900)).toBe('1900')
      expect(goldLivePolicy.pricePattern.test('1900')).toBe(true)
    })

    it('refuses everything that is not a positive bounded decimal, in either shape', () => {
      for (const value of [
        undefined, null, true, false, {}, [], 'live', 'three thousand',
        Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
        0, '0', -1, '-1', '-0', '0x10', '+1', '1.', '.5', ' 1', '1 ', '1,5', '1.9e3', 1e21,
        '1'.repeat(goldLivePolicy.maxPriceLength + 1),
        1e24 // `String` writes this in exponent form, which is not a decimal this product admits.
      ]) expect(goldLivePriceOf(value), String(value)).toBeUndefined()
      // The bound is inclusive, so a price of exactly the admitted length is still a price.
      const longest = `1${'0'.repeat(goldLivePolicy.maxPriceLength - 1)}`
      expect(goldLivePriceOf(longest)).toBe(longest)
    })
  })
})
