import { realMarketApiPolicy, type RealMarketApiFailureCode } from './realMarketApiPolicy'

/**
 * One level at one instant. The provider answers with JSON *numbers* and an ISO UTC `openTime`; the
 * parsers below accept exactly that and drop anything else rather than coercing it.
 */
export type RealMarketApiPoint = Readonly<{ atMs: number; value: number }>

export type RealMarketApiPointsResult =
  | Readonly<{ state: 'available'; points: readonly RealMarketApiPoint[] }>
  | Readonly<{ state: 'unavailable'; failureCode: RealMarketApiFailureCode }>

/**
 * The key is a query parameter, so these builders are the only place a URL is ever assembled. A
 * caller must never log, throw or store their result: the transport turns a failure into a code, and
 * every message this product logs names the symbol and the outcome, never the URL.
 */
export function realMarketApiPriceUrl(
  apiKey: string,
  symbolCode: string = realMarketApiPolicy.symbolCode,
  timeFrame: string = realMarketApiPolicy.latestTimeFrame
): string {
  const query = new URLSearchParams({ symbolCode, timeFrame, apiKey })
  return `${realMarketApiPolicy.baseUrl}/api/v1/price?${query.toString()}`
}

export function realMarketApiCandleUrl(
  apiKey: string,
  symbolCode: string = realMarketApiPolicy.symbolCode,
  timeFrame: string = realMarketApiPolicy.backfillTimeFrame,
  limit: number = realMarketApiPolicy.backfillLimit
): string {
  const query = new URLSearchParams({ symbolCode, timeFrame, limit: String(limit), apiKey })
  return `${realMarketApiPolicy.baseUrl}/api/v1/candle?${query.toString()}`
}

/** The provider's own error vocabulary, mapped the way FRED's and Twelve Data's already are. */
export function realMarketApiFailureCode(httpStatus: number): RealMarketApiFailureCode {
  if (httpStatus === 401) return 'credential-rejected'
  if (httpStatus === 403) return 'plan-restricted'
  if (httpStatus === 429) return 'rate-limited'
  return 'response-invalid'
}

/**
 * A price response is exactly the shape the provider published, or it is not a price at all.
 *
 * `symbolCode` is a parameter because two instruments already ride this one parser — the licensed
 * dollar index and the Nasdaq 100 index — and a response for the other symbol is not this symbol's
 * answer. It defaults to the dollar, which is the source this module was written for.
 */
export function parseRealMarketApiPrice(
  payload: unknown,
  httpStatus = 200,
  symbolCode: string = realMarketApiPolicy.symbolCode
): RealMarketApiPointsResult {
  // An error status is a failure whatever the body happens to look like: a page that carries a price
  // under a 401 is the provider telling us the request was refused, not answering it.
  if (httpStatus >= 400) return unavailable(httpStatus)
  if (!plainRecord(payload)) return unavailable(httpStatus)
  const record = payload as Record<string, unknown>
  if (record.symbolCode !== symbolCode) return unavailable(httpStatus)
  const point = pointOf(record.openTime, record.closePrice)
  // A level this product cannot read is dropped, never repaired: no level was stored, so no window
  // and no label can be built on top of a guess.
  return point ? Object.freeze({ state: 'available' as const, points: Object.freeze([point]) }) : unavailable(httpStatus)
}

/**
 * A candle page: newest first, one bar per instant. Bars with a missing field, a non-number close or
 * an unreadable `openTime` are dropped individually — a page carrying one bad bar is still a page of
 * good ones — and an empty result is reported as an unusable response rather than as "no change".
 */
export function parseRealMarketApiCandles(
  payload: unknown,
  httpStatus = 200,
  symbolCode: string = realMarketApiPolicy.symbolCode
): RealMarketApiPointsResult {
  if (httpStatus >= 400) return unavailable(httpStatus)
  if (!plainRecord(payload)) return unavailable(httpStatus)
  const rows = (payload as { data?: unknown }).data
  if (!Array.isArray(rows)) return unavailable(httpStatus)
  // Provider order first, so that a duplicate instant keeps the newest answer; then ascending, which
  // is the order the store and the windows read history in.
  const byAtMs = new Map<number, RealMarketApiPoint>()
  for (const row of rows) {
    if (!plainRecord(row)) continue
    const record = row as Record<string, unknown>
    if (record.symbolCode !== undefined && record.symbolCode !== symbolCode) continue
    const point = pointOf(record.openTime, record.closePrice)
    if (point && !byAtMs.has(point.atMs)) byAtMs.set(point.atMs, point)
  }
  const points = [...byAtMs.values()].sort((left, right) => left.atMs - right.atMs)
  return points.length > 0
    ? Object.freeze({ state: 'available' as const, points: Object.freeze(points) })
    : unavailable(httpStatus)
}

/** One candle with all five fields a bar needs. */
export type RealMarketApiBar = Readonly<{
  atMs: number; open: number; high: number; low: number; close: number
  /**
   * The provider's own volume, or `undefined` when it published none. A cash index has no traded
   * volume, so this parser reports the absence instead of substituting a zero: the caller is the only
   * layer that knows whether the field matters to it.
   */
  volume: number | undefined
}>

export type RealMarketApiBarsResult =
  | Readonly<{ state: 'available'; bars: readonly RealMarketApiBar[] }>
  | Readonly<{ state: 'unavailable'; failureCode: RealMarketApiFailureCode }>

/**
 * A candle page read as full bars rather than as closes.
 *
 * Same rules as the close-only reader: a row with an unreadable instant or an impossible body is
 * dropped on its own, a duplicate instant keeps the provider's newest answer, and a page with no
 * usable row is an unusable response rather than "no change".
 */
export function parseRealMarketApiBars(
  payload: unknown,
  httpStatus = 200,
  symbolCode: string = realMarketApiPolicy.symbolCode
): RealMarketApiBarsResult {
  if (httpStatus >= 400) return barsUnavailable(httpStatus)
  if (!plainRecord(payload)) return barsUnavailable(httpStatus)
  const rows = (payload as { data?: unknown }).data
  if (!Array.isArray(rows)) return barsUnavailable(httpStatus)
  const byAtMs = new Map<number, RealMarketApiBar>()
  for (const row of rows) {
    if (!plainRecord(row)) continue
    const record = row as Record<string, unknown>
    if (record.symbolCode !== undefined && record.symbolCode !== symbolCode) continue
    const bar = barOf(record)
    if (bar && !byAtMs.has(bar.atMs)) byAtMs.set(bar.atMs, bar)
  }
  const bars = [...byAtMs.values()].sort((left, right) => left.atMs - right.atMs)
  return bars.length > 0
    ? Object.freeze({ state: 'available' as const, bars: Object.freeze(bars) })
    : barsUnavailable(httpStatus)
}

function barsUnavailable(httpStatus: number): RealMarketApiBarsResult {
  return Object.freeze({ state: 'unavailable' as const, failureCode: realMarketApiFailureCode(httpStatus) })
}

function barOf(record: Record<string, unknown>): RealMarketApiBar | undefined {
  const atMs = parseProviderInstant(record.openTime)
  if (atMs === undefined) return undefined
  const values = [record.openPrice, record.highPrice, record.lowPrice, record.closePrice]
  if (!values.every(price)) return undefined
  const [open, high, low, close] = values as [number, number, number, number]
  if (low > Math.min(open, close) || high < Math.max(open, close)) return undefined
  const volume = record.volume
  if (volume !== undefined && (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0)) return undefined
  return Object.freeze({ atMs, open, high, low, close, volume: volume as number | undefined })
}

function price(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function pointOf(openTime: unknown, closePrice: unknown): RealMarketApiPoint | undefined {
  const atMs = parseProviderInstant(openTime)
  if (atMs === undefined) return undefined
  if (typeof closePrice !== 'number' || !Number.isFinite(closePrice) || closePrice <= 0) return undefined
  return Object.freeze({ atMs, value: closePrice })
}

/** The provider's `2026-10-14T11:00:00.000Z` as UTC. Anything that is not a canonical instant fails. */
export function parseProviderInstant(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const atMs = Date.parse(value)
  if (!Number.isFinite(atMs) || new Date(atMs).toISOString() !== value) return undefined
  return Number.isSafeInteger(atMs) && atMs >= 0 ? atMs : undefined
}

function unavailable(httpStatus: number): RealMarketApiPointsResult {
  return Object.freeze({ state: 'unavailable' as const, failureCode: realMarketApiFailureCode(httpStatus) })
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
