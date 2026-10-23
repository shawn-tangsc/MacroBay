/**
 * The macro-market source: the inputs the crypto reading depends on that Binance does not carry —
 * the dollar, gold, the offshore yuan and the stablecoin peg — pulled from a credentialed REST
 * provider because no admitted Binance instrument proxies them.
 *
 * Two facts shape this policy:
 *
 * 1. The provider publishes no ICE dollar index (its catalogue has no such symbol), while it does
 *    publish every currency in the ICE basket. So the dollar is *synthesised* from the basket with
 *    ICE's own published weights and formula, and labelled `synthetic-dollar-index` everywhere it
 *    appears. A level that is ours is never presented as the official index. Since the licensed index
 *    became available from a second source (see `realMarketApiPolicy`), this synthesis is what the
 *    dashboard falls back to whenever the real series is unconfigured or has stopped arriving — its
 *    collection, its budget and its formula are unchanged by that.
 * 2. The free tier meters **8 credits per minute and 800 per day**, and a multi-symbol request costs
 *    one credit per symbol. The tick split below keeps a 15-minute dollar series inside that budget
 *    with room for the extra series at half the cadence.
 */
import { macroMarketBackfillBars } from './macroMarketReturns'

/** The requested bar interval, named once so the backfill size below can be derived from it. */
const macroMarketIntervalMs = 15 * 60 * 1_000

export const macroMarketPolicy = Object.freeze({
  version: 'macroMarket.v1',
  sourceId: 'twelve-data-market',
  baseUrl: 'https://api.twelvedata.com',
  credentialRef: 'twelve-data-market',
  /** Bar interval requested from the provider; a multiple of five minutes so bars stay aligned. */
  interval: '15min' as const,
  intervalMs: macroMarketIntervalMs,
  timezone: 'UTC' as const,
  outputsize: 2,
  /**
   * The bars a thin series backfills with: the longest window the wire admits, at this interval.
   *
   * Derived from the contract rather than restated, because the last hand-kept number here — a
   * hundred bars, "a little over the longest window" while the ladder stopped at 24h — became a day
   * of history once `7d` joined the ladder, and a day cannot answer a week. That is why the 7d cell
   * read 无数据 on a fresh profile and only filled after days of accumulation.
   *
   * Measured against the provider: six symbols in one request are answered in full at a hundred
   * bars, while a request for a week at once came back with a single symbol. A backfill of this size
   * is therefore issued one symbol per request — a request costs one credit per symbol either way,
   * so splitting it changes neither the price nor the per-minute budget.
   */
  backfillOutputsize: macroMarketBackfillBars(macroMarketIntervalMs),
  maxBodyBytes: 1024 * 1024,
  timeoutMs: 20_000,
  /** Every tick: the six currencies the ICE index is built from. */
  tickSymbols: Object.freeze(['EUR/USD', 'USD/JPY', 'GBP/USD', 'USD/CAD', 'USD/SEK', 'USD/CHF'] as const),
  /**
   * Every second tick: the offshore yuan and the stablecoin peg.
   *
   * Gold used to be collected here, at fifteen minutes against this source's metered daily budget. It
   * now arrives from the licensed provider that already ticks every five minutes for the dollar, on
   * the same bar as the other instruments the panel draws — so this list no longer carries it, and no
   * second writer can touch that series.
   */
  halfCadenceSymbols: Object.freeze(['USD/CNH', 'USDT/USD'] as const),
  series: Object.freeze({
    dollarIndex: 'dxy-synthetic', gold: 'xau-usd', offshoreYuan: 'usd-cnh', stablecoinPeg: 'usdt-usd',
    /**
     * The licensed ICE index, written to this same store by the RealMarketAPI collector. It is listed
     * here because this object is the store's one series registry — the wire contract is asserted
     * against it — and because the fallback above is only a fallback while this series exists.
     */
    dollarIndexReal: 'dxy-real'
  } as const),
  /** Credits: one per symbol per request, and the tick split has to stay under the minute limit. */
  /**
   * The job wakes every five minutes and the plan decides what to fetch: the basket on the quarter
   * hour, the extra series five minutes later. The five-minute offset is the whole trick — nine
   * symbols in one minute would cost nine credits against a limit of eight, so the extras never
   * share a minute with the basket.
   */
  creditBudget: Object.freeze({
    perMinute: 8, perDay: 800, jobIntervalMinutes: 5, tickMinutes: 15, halfCadenceMinutes: 30, halfCadenceOffsetMinutes: 5
  }),
  caveats: Object.freeze({
    syntheticDollarIndex: 'synthetic-dollar-index',
    providerTimeSeries: 'provider-time-series'
  } as const),
  failureCodes: Object.freeze(['credential-missing', 'credential-rejected', 'plan-restricted', 'rate-limited', 'transport-unavailable', 'response-invalid'] as const)
})

export type MacroMarketFailureCode = typeof macroMarketPolicy.failureCodes[number]

/**
 * ICE's published US Dollar Index formula. The exponents are the basket weights; the leading
 * constant normalises the March 1973 base to 100. Kept here as data so the synthesis is auditable
 * against the published index rather than buried in arithmetic.
 */
export const dollarIndexFormula = Object.freeze({
  constant: 50.14348112,
  terms: Object.freeze([
    Object.freeze({ symbol: 'EUR/USD', exponent: -0.576 }),
    Object.freeze({ symbol: 'USD/JPY', exponent: 0.136 }),
    Object.freeze({ symbol: 'GBP/USD', exponent: -0.119 }),
    Object.freeze({ symbol: 'USD/CAD', exponent: 0.091 }),
    Object.freeze({ symbol: 'USD/SEK', exponent: 0.042 }),
    Object.freeze({ symbol: 'USD/CHF', exponent: 0.036 })
  ] as const)
})
