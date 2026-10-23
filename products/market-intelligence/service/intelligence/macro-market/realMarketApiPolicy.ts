/**
 * The real dollar index.
 *
 * The Twelve Data basket stays exactly where it was — the fallback path — while this source supplies
 * the provider's own ICE dollar index (symbol `DXY`) as a second series in the *same* store. Two
 * facts shape this policy:
 *
 * 1. The key travels as a **query parameter**, so a URL is credential material. Nothing here builds a
 *    URL for a log line, and no error message ever carries one: the transport collapses a failure to
 *    a code, exactly like the Twelve Data transport does.
 * 2. The plan is measured in **elapsed time since the last successful tick**, never in wall-clock
 *    minute arithmetic. The interval trigger fires on the phase it was registered at, so a
 *    "minute % 5 === 0" test would silently skip every tick: the tolerance below is what lets a tick
 *    that fires a second before the fifth minute still collect.
 */
import { macroMarketPolicy } from './macroMarketPolicy'
import { macroMarketBackfillBars } from './macroMarketReturns'

/**
 * The instruments this source answers, in request order, each with the series it is stored under.
 *
 * Both are the provider's own published series: the ICE dollar index and spot gold. Gold moved here
 * from the basket source, which collected it at fifteen minutes against a metered daily budget; this
 * source already ticks every five minutes for the dollar, so gold joins it on the same bar — and the
 * basket source drops gold entirely, because two writers of one series are two opinions about one
 * history.
 */
const realMarketApiSymbols = Object.freeze([
  Object.freeze({ symbolCode: 'DXY', series: 'dollarIndex' as const }),
  /**
   * The provider's own spelling for spot gold. It is the one constant here that could not be checked
   * against the provider's catalogue from the codebase, so the connection probe asks for every symbol
   * this list carries: a refusal is reported in the provider's own terms instead of arriving as a
   * series that quietly never fills.
   */
  Object.freeze({ symbolCode: 'XAUUSD', series: 'gold' as const })
] as const)

export const realMarketApiPolicy = Object.freeze({
  version: 'realMarketApi.v1',
  sourceId: 'realmarketapi-market',
  baseUrl: 'https://api.realmarketapi.com',
  credentialRef: 'realmarketapi-market',
  /** The primary instrument, and the default the URL builders fall back to. */
  symbolCode: realMarketApiSymbols[0].symbolCode,
  /** Every instrument one tick collects, in request order. */
  symbols: realMarketApiSymbols,
  /**
   * The tick asks for a five-minute bar, so every tick lands in a bar of its own and the newest stored
   * point is never older than one cadence. Both instruments are collected on that same bar.
   */
  latestTimeFrame: 'M5' as const,
  /** The backfill asks for the same five-minute bar: one grid for both series, history included. */
  backfillTimeFrame: 'M5' as const,
  /**
   * A week of five-minute bars — the longest window the wire admits, derived from the contract. A
   * fifteen-minute backfill would have been fewer bars for the same week, but it left the series on two
   * grids: five-minute points going forward beside fifteen-minute points behind.
   */
  backfillLimit: macroMarketBackfillBars(5 * 60_000),
  /** The collection cadence, and the slack that keeps it from slipping to ten minutes. */
  intervalMs: 5 * 60_000,
  dueToleranceMs: 60_000,
  /** But not on every tick: a provider stingy with bars must not turn each tick into two requests. */
  backfillRetryMs: 6 * 60 * 60_000,
  /**
   * The one-time deep backfill: a ladder of time frames, asked for once per series and never again.
   *
   * The provider's candle page carries about a day of bars whatever `limit` asks for — measured on this
   * account: a week requested, a hundred fifteen-minute bars returned, then two hundred five-minute
   * ones, each page covering roughly one day. A page is therefore deepened by asking for a coarser bar
   * rather than a bigger number: hourly bars reach about four days back in one page, four-hourly bars
   * more than a week, which is what the longest window needs. The fine rungs are still asked first, so
   * the recent day keeps its five-minute detail.
   *
   * It runs once because it is a repair, not a cadence: after it, the series either spans enough to
   * answer the week or the provider has told us it will not, and repeating eight requests every six
   * hours would only spend budget to learn the same thing again. `version` is part of the note names,
   * so changing this ladder deliberately re-arms it instead of needing a hand-edited database.
   */
  deepBackfill: Object.freeze({
    version: 'v1',
    steps: Object.freeze([
      Object.freeze({ timeFrame: 'M5', barMs: 5 * 60_000 }),
      Object.freeze({ timeFrame: 'M15', barMs: 15 * 60_000 }),
      Object.freeze({ timeFrame: 'H1', barMs: 60 * 60_000 }),
      Object.freeze({ timeFrame: 'H4', barMs: 4 * 60 * 60_000 })
    ] as const)
  } as const),
  maxBodyBytes: 1024 * 1024,
  timeoutMs: 20_000,
  /** The series this source writes, by the key its symbol table refers to. */
  series: Object.freeze({
    dollarIndex: macroMarketPolicy.series.dollarIndexReal,
    gold: macroMarketPolicy.series.gold
  } as const),
  /** One prefix, so the store's meta keys cannot collide with the basket collector's. */
  notes: Object.freeze({
    lastRunAtMs: 'realmarketapi.lastRunAtMs',
    lastPlan: 'realmarketapi.lastPlan',
    lastBackfillAtMs: 'realmarketapi.lastBackfillAtMs',
    /** The one-time deep backfill: when it ran, and what each rung of the ladder actually returned. */
    deepBackfill: Object.freeze({
      ranAtMs: 'realmarketapi.deepBackfillRanAtMs',
      evidence: 'realmarketapi.deepBackfillEvidence'
    } as const),
    lastFailureCode: 'realmarketapi.lastFailureCode',
    /** Which instrument failed, when the tick's other instrument still answered. */
    lastSymbolFailures: 'realmarketapi.lastSymbolFailures',
    /**
     * What the last tick actually did, written on **every** path: `disabled`, `idle`, `stored`,
     * `unchanged`, or `unavailable:<failureCode>`. The scheduler reports "completed" for anything
     * that returns instead of throwing, so without this note a source that never collected, never
     * spent a request and never failed is indistinguishable from one that is working — which is how a
     * key saved five minutes after the last tick read as "the panel still shows the synthesis".
     */
    lastOutcome: 'realmarketapi.lastOutcome'
  } as const),
  /**
   * Alphanumeric, of a plausible length. This is a cheap pre-filter that keeps an obviously malformed
   * draft from spending a request — it is not a claim about the exact length the provider issues, and
   * asserting one cost the reader a save button that refused a valid forty-eight character key.
   */
  apiKeyPattern: /^[0-9A-Za-z]{32,80}$/,
  failureCodes: Object.freeze([
    'credential-missing', 'credential-rejected', 'plan-restricted', 'rate-limited', 'transport-unavailable', 'response-invalid'
  ] as const)
})

export type RealMarketApiFailureCode = typeof realMarketApiPolicy.failureCodes[number]

/**
 * The note that records when one series last asked for history.
 *
 * Per series, not per tick: a fresh instrument needs its week pulled even while the other one already
 * has one, and one instrument's retry window must not hold the other's back.
 */
export function realMarketApiBackfillNote(seriesId: string): string {
  return `${realMarketApiPolicy.notes.lastBackfillAtMs}:${seriesId}`
}

/**
 * The notes of the one-time deep backfill, per series and per ladder version.
 *
 * `ranAtMs` is written once the ladder has been asked, whatever it answered: that is what makes it
 * once — and `evidence` records each rung's rows and span, so the provider's real ceiling is readable
 * from the store instead of being inferred from a blank window.
 */
export function realMarketApiDeepBackfillNote(seriesId: string, kind: 'ranAtMs' | 'evidence'): string {
  return `${realMarketApiPolicy.notes.deepBackfill[kind]}:${realMarketApiPolicy.deepBackfill.version}:${seriesId}`
}
