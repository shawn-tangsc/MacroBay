/**
 * The shape RealMarketAPI answers with, taken from a live Starter capture.
 *
 * The capture's own request is deliberately **not** here: the key travels as a query parameter, so a
 * fixture that carried a URL would be a credential committed to the repository. Only bodies are kept,
 * and every body below is exactly the shape the provider returned.
 */
export const realMarketApiPriceResponse = Object.freeze({
  symbolCode: 'DXY',
  openPrice: 102.249,
  closePrice: 102.237,
  highPrice: 102.268,
  lowPrice: 102.225,
  volume: 784,
  openTime: '2026-10-14T11:00:00.000Z',
  bid: 102.237,
  ask: 102.246
})

/**
 * Three M15 candles, newest first — the provider's order. The 11:30 row is the captured one; the two
 * older rows repeat its shape at their own instants, which is what the capture carried and is all a
 * test needs to pin ordering, de-duplication and the drop rules.
 */
export const realMarketApiCandleResponse = Object.freeze({
  data: Object.freeze([
    Object.freeze({
      symbolCode: 'DXY', openPrice: 102.24, closePrice: 102.236, highPrice: 102.244, lowPrice: 102.236,
      volume: 20, openTime: '2026-10-14T11:30:00.000Z'
    }),
    Object.freeze({
      symbolCode: 'DXY', openPrice: 102.246, closePrice: 102.24, highPrice: 102.25, lowPrice: 102.238,
      volume: 18, openTime: '2026-10-14T11:15:00.000Z'
    }),
    Object.freeze({
      symbolCode: 'DXY', openPrice: 102.243, closePrice: 102.246, highPrice: 102.252, lowPrice: 102.241,
      volume: 22, openTime: '2026-10-14T11:00:00.000Z'
    })
  ])
})

/** The instants the two fixtures carry, named once so a test does not restate literals. */
export const realMarketApiFixtureInstants = Object.freeze({
  price: Date.parse('2026-10-14T11:00:00.000Z'),
  newestCandle: Date.parse('2026-10-14T11:30:00.000Z')
})
