/**
 * The wire contract for notional open interest.
 *
 * One source (Binance USDT-M perpetuals), one stored resolution (15 minutes), two display
 * windows. The window is a query parameter rather than a second history: the 7-day view is
 * the 15-minute rows folded to one point per hour, computed at read time and never stored.
 */
/**
 * The one bucket width for notional open interest.
 *
 * Every count and every name in this domain that used to encode it — the volume lookback, the
 * kline request limit, the stored period label — is derived from here. A second copy is how the
 * reference window silently shrinks when the bucket gets finer: `96 bars` is 24 hours at fifteen
 * minutes and 8 hours at five, and no assertion would notice.
 */
export const openInterestBucketPolicy = Object.freeze({
  /** The width the store keeps, one row per bucket. */
  storageBucketMs: 900_000,
  /**
   * The width the liquidation rule judges one bucket on.
   *
   * Never finer than `storageBucketMs`, and always a whole multiple of it: a judgement bucket
   * narrower than what is stored could only be produced by interpolation, and an interpolated
   * reading is a made-up number wearing the same clothes as a measured one.
   */
  signalBucketMs: 900_000
})

/**
 * Why the two widths may differ, and when they may not.
 *
 * The storage bucket can get finer without changing what the rule reads; the rule's own bucket
 * cannot get finer than what is actually stored. Everything else about the pair is arithmetic.
 */
export function isBucketPolicyValid(policy: Readonly<{ storageBucketMs: number; signalBucketMs: number }> = openInterestBucketPolicy): boolean {
  const { storageBucketMs, signalBucketMs } = policy
  if (!Number.isInteger(storageBucketMs) || !Number.isInteger(signalBucketMs)) return false
  if (storageBucketMs <= 0 || signalBucketMs <= 0) return false
  return signalBucketMs >= storageBucketMs && signalBucketMs % storageBucketMs === 0
}

/**
 * Buckets that fit in a span. The only division by a bucket width in this domain.
 *
 * The width is required: a default here would silently pick one of the two widths, and picking
 * the wrong one turns a day of volume baseline into eight hours without a single assertion.
 */
export function bucketsInSpan(spanMs: number, bucketMs: number): number {
  return Math.round(spanMs / bucketMs)
}

/**
 * How many requests a span needs at a per-request cap.
 *
 * Newest first, one request per batch: the batch count is the coverage, so a finer bucket widens
 * the plan instead of quietly growing a single request past the endpoint's limit.
 */
export function batchesForSpan(spanMs: number, perRequestCap: number, bucketMs: number): number {
  if (!(perRequestCap > 0)) return Number.POSITIVE_INFINITY
  return Math.ceil(bucketsInSpan(spanMs, bucketMs) / perRequestCap)
}

/** The provider's period label for a bucket width (`15m`, `5m`), derived rather than spelled twice. */
export function bucketPeriodLabel(bucketMs: number): string {
  return `${Math.round(bucketMs / 60_000)}m`
}

export const openInterestHistoryPolicy = Object.freeze({
  sourceId: 'binance-futures-positioning',
  storedPeriod: bucketPeriodLabel(openInterestBucketPolicy.storageBucketMs),
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
  /**
   * Per-request caps, not a coverage.
   *
   * `openInterestHist` refuses limit > 500; the kline endpoint accepts more than we ever ask, so
   * 1000 is the conservative ceiling. How much history a round covers is a count of batches
   * (`batchesForSpan`), deliberately not a bigger number here: one field serving both "how many
   * per request" and "how far back" is what turned a 7-day backfill into a single oversized
   * request the moment the bucket got finer.
   */
  requestLimit: Object.freeze({ openInterest: 500, klines: 1000 }),
  /** A guard, not a plan: beyond this many batches a round is asking the wrong question. */
  maximumBatchesPerEndpoint: 6,
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
  /** 哪一边被清：多头（价格跌）或空头（价格涨）。两条规则各判各的。 */
  direction: 'long' | 'short'
  dropPct: number
  volumeMultiple: number
  /** The notional open interest of the marked bucket, so the mark can be drawn on the line. */
  notionalUsd: number
  /** 判定那一格的收盘价与带符号涨跌；老读取没有就不带。 */
  closePrice?: number
  pricePct?: number
}>

export type OpenInterestHistoryResult =
  | Readonly<{
      state: 'available'
      asOf: string
      window: OpenInterestWindow
      btc: readonly OpenInterestPoint[]
      eth: readonly OpenInterestPoint[]
      change?: Readonly<Record<'btc' | 'eth', OpenInterestChange>>
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

/**
 * The single validator both the IPC handler and the renderer client call.
 *
 * One implementation, because a second one drifts: the handler would accept a shape the client
 * then rejects, and the card would go blank with no failing test.
 */
export function isOpenInterestHistoryResult(value: unknown, asOf: string, window: OpenInterestWindow): value is OpenInterestHistoryResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.state === 'empty') return record.asOf === asOf && record.window === window && Object.keys(record).length === 3
  if (record.state === 'unavailable') {
    return record.failureCode === openInterestHistoryPolicy.unavailableFailureCode && Object.keys(record).length === 2
  }
  if (record.state !== 'available' || record.asOf !== asOf || record.window !== window) return false
  if (!isOpenInterestSeries(record.btc, asOf) || !isOpenInterestSeries(record.eth, asOf)) return false

  if (record.change !== undefined) {
    if (!isPlainRecord(record.change)) return false
    for (const asset of ['btc', 'eth'] as const) {
      const entry = (record.change as Record<string, unknown>)[asset]
      if (entry === undefined) continue
      if (!isPlainRecord(entry)) return false
      for (const key of ['h1Pct', 'h24Pct'] as const) {
        const amount = (entry as Record<string, unknown>)[key]
        if (amount !== undefined && !isOpenInterestChange(amount)) return false
      }
    }
  }

  if (record.liquidationHints !== undefined) {
    if (!Array.isArray(record.liquidationHints) || record.liquidationHints.length > openInterestHistoryPolicy.maximumLiquidationHints) return false
    for (const hint of record.liquidationHints) {
      if (!isPlainRecord(hint)) return false
      const entry = hint as Record<string, unknown>
      if (!isCanonicalOpenInterestTime(entry.observedAt) || entry.observedAt > asOf) return false
      if (entry.asset !== 'btc' && entry.asset !== 'eth') return false
      if (typeof entry.dropPct !== 'number' || !Number.isFinite(entry.dropPct) || entry.dropPct > 0) return false
      if (typeof entry.volumeMultiple !== 'number' || !Number.isFinite(entry.volumeMultiple) || entry.volumeMultiple < 0) return false
      if (!isOpenInterestNotional(entry.notionalUsd)) return false
    }
  }

  if (record.liquidationHintsTruncated !== undefined && typeof record.liquidationHintsTruncated !== 'boolean') return false
  if (record.liquidationHintsState !== 'available' && record.liquidationHintsState !== 'unavailable') return false
  return true
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}
