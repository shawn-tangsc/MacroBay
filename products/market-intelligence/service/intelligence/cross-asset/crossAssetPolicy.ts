// CA1 designs 124–127; Market Intelligence owns these limits and exact identities.
// Changes require product acceptance and the adjacent client/stream regressions.

/**
 * The Binance contracts this product collects. `proxy` is the tokenised Nasdaq 100 perpetual
 * (`QQQUSDT`): a 24/7 synthetic that is **not** the standard index. It is kept collected so it can
 * answer the index row the moment the licensed index cannot — and it is labelled whenever it does.
 */
const binanceAssets = Object.freeze({ proxy: 'QQQUSDT', btc: 'BTCUSDT', eth: 'ETHUSDT' } as const)

/**
 * The rows the snapshot and the panel publish, and the symbol that answers each row by preference.
 * The index row's preferred symbol is the provider's real Nasdaq 100 index; the Binance proxy above
 * is the row's fallback rather than its identity.
 */
const assets = Object.freeze({ index: 'USTEC', btc: 'BTCUSDT', eth: 'ETHUSDT' } as const)

export type CrossAssetRow = keyof typeof assets
export type BinanceAsset = keyof typeof binanceAssets

export const crossAssetPolicy = Object.freeze({
  sourceId: 'binance-futures-positioning', capabilityId: 'cross-asset-market',
  productionIntent: 'automatic' as const, interfaceTestIntent: 'user' as const,
  baseUrl: 'https://fapi.binance.com',
  historyPath: '/fapi/v1/klines',
  metadataPath: '/fapi/v1/exchangeInfo', metadataMaxBytes: 4 * 1024 ** 2,
  interval: '5m', intervalMs: 300_000,
  /** The published rows. `index` is the Nasdaq 100 row, in either of its two admitted sources. */
  assets,
  /** The Binance contracts behind the rows: the proxy for `index`, and the two crypto contracts. */
  binanceAssets,
  /**
   * Every symbol the store may hold. Both index legs are stored: the licensed index is preferred, and
   * the tokenised perpetual is collected beside it so the fallback is never an empty row.
   */
  storedSymbols: Object.freeze(['USTEC', 'QQQUSDT', 'BTCUSDT', 'ETHUSDT'] as const),
  /**
   * The real Nasdaq 100 index, from the same licensed provider that already answers the dollar.
   *
   * The row's **fallback**, not its default: Binance's tokenised perpetual answers first because it
   * streams and prints around the clock, and this licensed cash index answers when that leg has
   * nothing. It prints only inside the US cash session (09:30–16:00 New York), which is a property of
   * the market rather than a failure of the source: while it answers, the row shows the last closed
   * bar and says 休市 outside those hours.
   *
   * The cadence is fifteen minutes because a fallback does not need to tick: one request per quarter
   * hour is 2,880 requests a month, which leaves the provider's budget to the **real dollar index**
   * (8,640 a month at five minutes) instead of spending it twice on this one. The bar it reads is
   * still the five-minute series, so the curve keeps the panel's granularity.
   */
  index: Object.freeze({
    sourceId: 'realmarketapi-market', symbol: 'USTEC', timeFrame: 'M5' as const,
    /** Twenty-four hours of five-minute bars: one request covers a whole session plus its gap. */
    candleLimit: 288,
    /** Fifteen minutes, so the fallback costs a third of what a five-minute poll would. */
    intervalMs: 15 * 60_000,
    row: 'index' as CrossAssetRow,
    /** The Binance contract that answers the row by default, and the label it must wear to do so. */
    proxyAsset: 'proxy' as BinanceAsset, proxySymbol: 'QQQUSDT'
  }),
  /**
   * Which Binance contract carries the live trade for a row. The index row's live quote is the
   * proxy's, so it is read only while the proxy is the row's selected source.
   */
  liveQuoteAssets: Object.freeze({ index: 'proxy', btc: 'btc', eth: 'eth' } as const),
  identities: Object.freeze({
    proxy: Object.freeze({ baseAsset: 'QQQ', contractType: 'TRADIFI_PERPETUAL' }),
    btc: Object.freeze({ baseAsset: 'BTC', contractType: 'PERPETUAL' }),
    eth: Object.freeze({ baseAsset: 'ETH', contractType: 'PERPETUAL' })
  }),
  tradingStatus: 'TRADING', quoteAsset: 'USDT', priceFilter: 'PRICE_FILTER',
  maxLimit: 1000, maxBodyBytes: 1024 * 1024, timeoutMs: 15_000,
  http: Object.freeze({ rateLimited: 429, banned: 418, retryFallbackMs: 60_000, millisecondsPerSecond: 1000, deltaSeconds: /^\d+$/, httpDate: /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/ }),
  mime: 'application/json', decimalPattern: /^(?:0|[1-9]\d*)(?:\.\d+)?$/, decimalMaxLength: 64,
  inputFields: Object.freeze(['asset', 'endMs', 'limit']),
  historyInputFields: Object.freeze(['asset', 'endMs']),
  historyMaxPoints: 2017, historyMaxPages: 3,
  leases: Object.freeze({ ttlMs: 30_000, maxActive: 4, profileCheckMs: 5000 }),
  reconnect: Object.freeze({ delaysMs: Object.freeze([1000, 2000, 4000, 8000, 16_000, 30_000]), jitterRatio: .2, stableResetMs: 60_000 }),
  repair: Object.freeze({ missingGraceMs: 90_000, minIntervalMs: 300_000, trailingBars: 12 }),
  interfaceTest: Object.freeze({ deadlineMs: 60_000, streamSampleMs: 15_000, historyLimit: 2, maxListeners: 1 }),
  stream: Object.freeze({
    baseUrl: 'wss://fstream.binance.com/market/stream', subscriptions: Object.freeze(['kline_5m', 'aggTrade']),
    maxMessageBytes: 64 * 1024, maxClosedPending: 128, freshnessMs: 15_000, futureToleranceMs: 5000
  }),
  governance: Object.freeze({
    providerId: 'binance', quotaScope: 'source' as const,
    rollingWindow: Object.freeze({ maxRequests: 12, windowMs: 60_000 }),
    queue: Object.freeze({ ordering: 'fifo' as const, maxPending: 4, maxWaitMs: 60_000 }),
    settingVisibility: 'hidden' as const
  })
})
