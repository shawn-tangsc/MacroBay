import type { CapitalConditionsHttpResult } from '../capital-conditions/capitalConditionsHttpClient'

/**
 * The USDT+USDC *core* stablecoin supply as of an instant, read from DefiLlama's per-asset history.
 *
 * Why this exists: the capital store only answers instants the app was awake for. A briefing frozen
 * at its 00:00Z cutoff and generated after the machine started at 04:48Z has no stored point at or
 * before the cutoff, so the funds row prints a gap even though the public per-asset series do cover
 * that instant. The backfill tool asks this reader only after the local store has said it holds
 * nothing at or before the instant (`state: 'empty'`); a stored point always wins, and a disabled or
 * broken store is never read around.
 *
 * Which series answers: DefiLlama's per-asset endpoint for each core asset
 * (`/stablecoin/1` for USDT, `/stablecoin/2` for USDC). Each payload carries the asset's whole daily
 * `tokens` series, whose `circulating.peggedUSD` is the same quantity the current-state refresh reads
 * for that asset — unlike `stablecoincharts/all`, which is every USD-pegged asset and therefore a
 * different, wider metric. The two newest completed daily points (one per asset) are added; a value
 * is returned only when *both* assets answered. One missing asset is never replaced by zero, by the
 * other asset alone, or by the aggregate series.
 *
 * Both endpoints are read through the capital refresh's existing bounded, proxy-aware client — no
 * second transport, no raw fetch — and each response is streamed under a named byte cap because one
 * asset's JSON is ~22-24 MB. Successful per-asset series are cached for the reader's lifetime, so
 * an edition that asks twice downloads each asset once. A failure is not cached as an answer.
 *
 * A daily point is a fact about its day: DefiLlama keeps updating the row for the current day, so
 * the row for the cutoff's own day is never admitted. The observation instant is the day's end
 * (D+1 00:00Z), the instant at which the value became knowable. A cutoff at D 00:00Z therefore
 * answers with D-1, exactly as the ETF and FRED readers gate their days.
 */

export const stablecoinHistoryAsOfPolicy = Object.freeze({
  method: 'historical-api' as const,
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  dayMilliseconds: 24 * 60 * 60 * 1_000,
  maximumSupplyUsd: Number.MAX_SAFE_INTEGER,
  /**
   * The fact contract carries one source URL. The core level is a sum of two separately fetched
   * per-asset series, so the first component names the read path here while every component keeps
   * its own endpoint below.
   */
  sourceUrl: 'https://stablecoins.llama.fi/stablecoin/1',
  assets: Object.freeze([
    Object.freeze({
      assetId: '1' as const,
      symbol: 'USDT' as const,
      pegType: 'peggedUSD' as const,
      pegMechanism: 'fiat-backed' as const,
      sourceUrl: 'https://stablecoins.llama.fi/stablecoin/1'
    }),
    Object.freeze({
      assetId: '2' as const,
      symbol: 'USDC' as const,
      pegType: 'peggedUSD' as const,
      pegMechanism: 'fiat-backed' as const,
      sourceUrl: 'https://stablecoins.llama.fi/stablecoin/2'
    })
  ])
})

export type StablecoinHistoryAsset = (typeof stablecoinHistoryAsOfPolicy.assets)[number]

export type StablecoinHistoryAsOfRequest = Readonly<{ asOf: string }>

export type StablecoinHistoryAsOfGapCode =
  | 'invalid-as-of'
  | 'future-as-of'
  /**
   * One of the two core series was not available — no interface wired, the source switched off, a
   * refused request, a payload that is not that asset's series, or no completed point. The core
   * level cannot be answered without both, so this is never filled with a number.
   */
  | 'historical-api-unavailable'

export type StablecoinHistoryAssetPoint = Readonly<{
  assetId: StablecoinHistoryAsset['assetId']
  symbol: StablecoinHistoryAsset['symbol']
  value: number
  /** The completed UTC day the point belongs to. */
  tradingDate: string
  /** The instant that day ended, which is when the point became knowable. */
  observedAt: string
  sourceUrl: string
}>

export type StablecoinHistoryAsOfReading = Readonly<{
  state: 'available'
  asOf: string
  value: number
  /** The newer of the two component observation instants, always at or before `asOf`. */
  observedAt: string
  components: readonly [StablecoinHistoryAssetPoint, StablecoinHistoryAssetPoint]
  sourceUrl: string
  method: typeof stablecoinHistoryAsOfPolicy.method
}>

export type StablecoinHistoryAsOfGap = Readonly<{
  state: 'unavailable'
  asOf: string
  gapCode: StablecoinHistoryAsOfGapCode
  detail: string
}>

export type StablecoinHistoryAsOfResult = StablecoinHistoryAsOfReading | StablecoinHistoryAsOfGap

/**
 * What the per-asset transport answered. `not-configured` is the wiring's way of saying the source
 * is switched off or no client exists, which is a missing interface rather than a failed request.
 */
export type StablecoinAssetHistoryApiResult =
  | CapitalConditionsHttpResult
  | Readonly<{ state: 'not-configured' }>

export type StablecoinHistoryAsOfDeps = Readonly<{
  /**
   * One asset's bounded history request. `undefined` means this build has no provider client, which
   * is `historical-api-unavailable` rather than a value or a silent skip.
   */
  requestAssetHistory?: (assetId: StablecoinHistoryAsset['assetId']) => Promise<StablecoinAssetHistoryApiResult>
  now?: () => number
}>

/** What one asset's daily series looks like after parsing; the payload itself is not retained. */
type AssetSeries =
  | Readonly<{ state: 'available'; points: ReadonlyMap<number, number> }>
  | Readonly<{ state: 'unavailable'; reason: 'response-body-too-large' | 'response-unavailable' }>
  | Readonly<{ state: 'not-configured' }>
  | Readonly<{ state: 'invalid-payload' }>

export function createStablecoinHistoryAsOf(deps: StablecoinHistoryAsOfDeps) {
  // The parsed day series, not the ~22 MB payload, is what is kept. A successful series answers
  // every instant; a failed or refused request is deleted on resolution because a failure is not an
  // answer, and a later read of the same edition may retry it.
  const histories = new Map<string, Promise<AssetSeries>>()

  function seriesOnce(identity: StablecoinHistoryAsset): Promise<AssetSeries> {
    const requestAssetHistory = deps.requestAssetHistory
    if (!requestAssetHistory) return Promise.resolve(Object.freeze({ state: 'not-configured' as const }))
    const cached = histories.get(identity.assetId)
    if (cached) return cached
    const pending = requestAssetHistory(identity.assetId).then((response): AssetSeries => {
      if (response.state === 'not-configured') return Object.freeze({ state: 'not-configured' as const })
      if (response.state === 'unavailable') {
        histories.delete(identity.assetId)
        return Object.freeze({ state: 'unavailable' as const, reason: response.reason })
      }
      const points = assetSupplyPoints(response.payload, identity)
      if (!points) {
        histories.delete(identity.assetId)
        return Object.freeze({ state: 'invalid-payload' as const })
      }
      return Object.freeze({ state: 'available' as const, points })
    }).catch((error: unknown) => {
      histories.delete(identity.assetId)
      throw error
    })
    histories.set(identity.assetId, pending)
    return pending
  }

  return {
    async read(request: StablecoinHistoryAsOfRequest): Promise<StablecoinHistoryAsOfResult> {
      const asOf = typeof request?.asOf === 'string' ? request.asOf.trim() : ''
      if (!isCanonicalInstant(asOf)) {
        return gap(asOf, 'invalid-as-of', 'asOf must be a canonical UTC instant, for example 2026-10-30T00:00:00.000Z.')
      }
      const asOfMs = Date.parse(asOf)
      const nowMs = (deps.now ?? Date.now)()
      if (!Number.isFinite(nowMs) || asOfMs > nowMs) {
        return gap(asOf, 'future-as-of', 'asOf is after the current time; a historical read may not answer the future.')
      }

      const points: StablecoinHistoryAssetPoint[] = []
      for (const identity of stablecoinHistoryAsOfPolicy.assets) {
        let series: AssetSeries
        try {
          series = await seriesOnce(identity)
        } catch {
          return gap(asOf, 'historical-api-unavailable', `the DefiLlama ${identity.symbol} per-asset history request failed.`)
        }
        if (series.state === 'not-configured') {
          return gap(
            asOf,
            'historical-api-unavailable',
            `no DefiLlama ${identity.symbol} per-asset history interface is wired, or the stablecoin source is switched off.`
          )
        }
        if (series.state === 'unavailable') {
          return gap(
            asOf,
            'historical-api-unavailable',
            `the DefiLlama ${identity.symbol} per-asset history request was refused (${series.reason}).`
          )
        }
        if (series.state === 'invalid-payload') {
          return gap(
            asOf,
            'historical-api-unavailable',
            `the DefiLlama ${identity.symbol} payload is not that asset's daily supply series.`
          )
        }
        const point = newestCompletedPoint(series.points, asOfMs)
        if (!point) {
          return gap(
            asOf,
            'historical-api-unavailable',
            `the DefiLlama ${identity.symbol} series holds no completed daily supply point at or before this instant.`
          )
        }
        points.push(Object.freeze({
          assetId: identity.assetId,
          symbol: identity.symbol,
          value: point.value,
          tradingDate: new Date(point.instantMs).toISOString().slice(0, 10),
          observedAt: new Date(point.instantMs + stablecoinHistoryAsOfPolicy.dayMilliseconds).toISOString(),
          sourceUrl: identity.sourceUrl
        }))
      }

      const [usdt, usdc] = points as [StablecoinHistoryAssetPoint, StablecoinHistoryAssetPoint]
      const value = usdt.value + usdc.value
      if (!isValidSupply(value) || value <= 0) {
        return gap(asOf, 'historical-api-unavailable', 'the two per-asset supplies do not add up to a readable core level.')
      }
      const observedAt = new Date(Math.max(Date.parse(usdt.observedAt), Date.parse(usdc.observedAt))).toISOString()
      if (observedAt > asOf) {
        return gap(asOf, 'historical-api-unavailable', `the core observation ${observedAt} is newer than the requested instant.`)
      }
      return Object.freeze({
        state: 'available' as const,
        asOf,
        value,
        observedAt,
        components: Object.freeze([usdt, usdc]) as readonly [StablecoinHistoryAssetPoint, StablecoinHistoryAssetPoint],
        sourceUrl: stablecoinHistoryAsOfPolicy.sourceUrl,
        method: stablecoinHistoryAsOfPolicy.method
      })
    }
  }
}

export type StablecoinHistoryAsOfQuery = ReturnType<typeof createStablecoinHistoryAsOf>

/**
 * The newest daily point whose UTC day had ended by the instant.
 *
 * A row that is not stamped at a UTC midnight is skipped rather than placed by guessing; the public
 * response is long-lived and one malformed row must not turn a readable instant into a gap. A day
 * the provider contradicts itself about is skipped too, never resolved by row order.
 */
function newestCompletedPoint(
  points: ReadonlyMap<number, number>,
  asOfMs: number
): Readonly<{ instantMs: number; value: number }> | undefined {
  let newest: Readonly<{ instantMs: number; value: number }> | undefined
  for (const [instantMs, value] of points) {
    if (instantMs + stablecoinHistoryAsOfPolicy.dayMilliseconds > asOfMs) continue
    if (!newest || instantMs > newest.instantMs) newest = Object.freeze({ instantMs, value })
  }
  return newest
}

/**
 * Every day DefiLlama stamped with a supply for this one asset.
 *
 * The payload must identify itself as the requested asset (id, symbol, USD peg, fiat-backed
 * mechanism): a USDT series served under the USDC request is a failed read, not a USDC point.
 * `undefined` means the payload is not this asset's series; an empty map means it is the series but
 * carries no usable day. Both end as the same named gap upstream, never as zero supply.
 */
function assetSupplyPoints(
  payload: unknown,
  identity: StablecoinHistoryAsset
): ReadonlyMap<number, number> | undefined {
  const asset = plainRecord(payload)
  if (!asset) return undefined
  if (readAssetId(asset) !== identity.assetId) return undefined
  if (readValue(asset, 'symbol') !== identity.symbol) return undefined
  if (readValue(asset, 'pegType') !== identity.pegType) return undefined
  if (readValue(asset, 'pegMechanism') !== identity.pegMechanism) return undefined
  const tokens = readValue(asset, 'tokens')
  if (!Array.isArray(tokens)) return undefined

  const points = new Map<number, number | undefined>()
  for (const token of tokens) {
    const row = plainRecord(token)
    if (!row) continue
    const epochSeconds = readEpochSeconds(readValue(row, 'date'))
    if (epochSeconds === undefined || epochSeconds % 86_400 !== 0) continue
    const circulating = plainRecord(readValue(row, 'circulating'))
    const supply = circulating ? readValue(circulating, 'peggedUSD') : undefined
    if (!isValidSupply(supply)) continue
    const instantMs = epochSeconds * 1_000
    const previous = points.get(instantMs)
    if (previous === undefined && !points.has(instantMs)) points.set(instantMs, supply)
    else if (previous !== supply) points.set(instantMs, undefined)
  }

  const readable = new Map<number, number>()
  for (const [instantMs, supply] of points) {
    if (supply !== undefined) readable.set(instantMs, supply)
  }
  return readable
}

function readAssetId(asset: Record<string, unknown>): string | undefined {
  const id = readValue(asset, 'id')
  return (typeof id === 'number' && Number.isSafeInteger(id) && id >= 0) || (typeof id === 'string' && /^(?:0|[1-9][0-9]*)$/.test(id))
    ? String(id)
    : undefined
}

function readEpochSeconds(value: unknown): number | undefined {
  const epochSeconds = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value) ? Number(value) : undefined
  return epochSeconds !== undefined && Number.isSafeInteger(epochSeconds) && epochSeconds >= 0 && epochSeconds <= 8_640_000_000_000
    ? epochSeconds
    : undefined
}

function isValidSupply(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= stablecoinHistoryAsOfPolicy.maximumSupplyUsd
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return undefined
    return value as Record<string, unknown>
  } catch {
    return undefined
  }
}

function readValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key)
  return descriptor?.enumerable === true && 'value' in descriptor ? descriptor.value : undefined
}

function gap(asOf: string, gapCode: StablecoinHistoryAsOfGapCode, detail: string): StablecoinHistoryAsOfGap {
  return Object.freeze({ state: 'unavailable' as const, asOf, gapCode, detail })
}

function isCanonicalInstant(value: unknown): value is string {
  return typeof value === 'string' && stablecoinHistoryAsOfPolicy.canonicalUtcMillisPattern.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
