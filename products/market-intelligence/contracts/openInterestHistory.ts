import type { PositioningState } from './openInterestPositioning'

/**
 * The wire contract for notional open interest.
 *
 * One source (Binance USDT-M perpetuals), one stored resolution (15 minutes), two display
 * windows. The window is a query parameter rather than a second history: the 7-day view is
 * the 15-minute rows folded to one point per hour, computed at read time and never stored.
 */
export const openInterestHistoryPolicy = Object.freeze({
  sourceId: 'binance-futures-positioning',
  storedPeriod: '15m' as const,
  windows: Object.freeze({
    '7d': Object.freeze({ spanMs: 7 * 86_400_000, resolution: '1h' as const, maximumPointsPerAsset: 172 }),
    '24h': Object.freeze({ spanMs: 86_400_000, resolution: '15m' as const, maximumPointsPerAsset: 100 })
  }),
  /**
   * Measured, not guessed: a 7-day window reaches 169 points when the newest bucket lands on
   * the hour and 168 when it does not (672 buckets span 167h45m, not 168h), and the whole DTO
   * is 25,304 B — so 32 KiB leaves room for a longer year and one liquidation mark.
   */
  maximumDtoBytes: 32 * 1024,
  changeWindowsMs: Object.freeze({ h1: 3_600_000, h24: 86_400_000 }),
  maximumLiquidationHints: 8,
  endpoint: 'https://fapi.binance.com/futures/data/openInterestHist',
  klinesEndpoint: 'https://fapi.binance.com/fapi/v1/klines',
  /** `openInterestHist` rejects limit > 500, so a cold start is always two requests. */
  requestLimit: Object.freeze({ openInterest: 500, klines: 672 }),
  timeoutMs: 15_000,
  maximumResponseBytes: 256 * 1024,
  unavailableFailureCode: 'open-interest-history-query-unavailable' as const,
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
})

export type OpenInterestWindow = keyof typeof openInterestHistoryPolicy.windows

export const openInterestWindows = Object.freeze(['7d', '24h'] as const)

export type OpenInterestPoint = Readonly<{ observedAt: string; notionalUsd: number }>

export type OpenInterestChange = Readonly<{ h1Pct?: number; h24Pct?: number }>

export type OpenInterestLiquidationHint = Readonly<{
  observedAt: string
  asset: 'btc' | 'eth'
  dropPct: number
  volumeMultiple: number
}>

export type OpenInterestHistoryResult =
  | Readonly<{
      state: 'available'
      asOf: string
      window: OpenInterestWindow
      btc: readonly OpenInterestPoint[]
      eth: readonly OpenInterestPoint[]
      change?: Readonly<Record<'btc' | 'eth', OpenInterestChange>>
      positioning?: Readonly<Record<'btc' | 'eth', PositioningState>>
      liquidationHints?: readonly OpenInterestLiquidationHint[]
      liquidationHintsTruncated?: boolean
      /**
       * `unavailable` means the volume leg could not answer, so an empty `liquidationHints`
       * there is "cannot tell", not "nothing happened". A panel must not treat them alike.
       */
      liquidationHintsState: 'available' | 'unavailable'
    }>
  | Readonly<{ state: 'empty'; asOf: string; window: OpenInterestWindow }>
  | Readonly<{ state: 'unavailable'; failureCode: 'open-interest-history-query-unavailable' }>

/** Notional open interest is a positive USDT amount; anything else is a parse failure. */
export function isOpenInterestNotional(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function isOpenInterestChange(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 10_000
}

export function isOpenInterestWindow(value: unknown): value is OpenInterestWindow {
  return value === '7d' || value === '24h'
}

export function isCanonicalOpenInterestTime(value: unknown): value is string {
  if (typeof value !== 'string' || !openInterestHistoryPolicy.canonicalUtcMillisPattern.test(value)) return false
  try { return new Date(value).toISOString() === value } catch { return false }
}

export function openInterestUnavailable(): Extract<OpenInterestHistoryResult, { state: 'unavailable' }> {
  return { state: 'unavailable', failureCode: openInterestHistoryPolicy.unavailableFailureCode }
}

/** Points of one asset must be strictly ascending and inside the requested window. */
export function isOpenInterestSeries(value: unknown, asOf: string): value is readonly OpenInterestPoint[] {
  if (!Array.isArray(value) || value.length > Math.max(...openInterestWindows.map(window => openInterestHistoryPolicy.windows[window].maximumPointsPerAsset))) return false
  let previous = ''
  for (const point of value) {
    if (!point || typeof point !== 'object' || Array.isArray(point)) return false
    const record = point as Record<string, unknown>
    if (!isCanonicalOpenInterestTime(record.observedAt) || !isOpenInterestNotional(record.notionalUsd)) return false
    if (record.observedAt <= previous || record.observedAt > asOf) return false
    previous = record.observedAt
  }
  return true
}
