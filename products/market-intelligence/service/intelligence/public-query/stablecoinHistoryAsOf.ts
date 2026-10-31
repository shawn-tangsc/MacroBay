import type { CapitalConditionsHttpResult } from '../capital-conditions/capitalConditionsHttpClient'

/**
 * The stablecoin supply DefiLlama published for an instant, read from its public history.
 *
 * Why this exists: the capital store only answers instants the app was awake for. A briefing frozen
 * at its 00:00Z cutoff and generated after the machine started at 04:48Z has no stored point at or
 * before the cutoff, so the funds row prints a gap even though the public series does cover that
 * instant. The backfill tool asks this reader only after the local store has said it holds nothing
 * at or before the instant (`state: 'empty'`); a stored point always wins, and a disabled or broken
 * store is never read around.
 *
 * Which series answers: DefiLlama's aggregate USD-pegged supply (`stablecoincharts/all`), the same
 * public history the capital refresh already derives its stablecoin daily flows from. It is read
 * through that refresh's bounded, proxy-aware client — no second transport, no raw fetch — and the
 * newest daily point whose day had ended by `asOf` is the answer. A daily point is a fact about its
 * day: DefiLlama keeps updating it while the day runs, so the row for the cutoff's own day is never
 * admitted, the same rule the ETF and FRED readers apply to theirs. The fact carries
 * `method: 'historical-api'` and this module's `sourceUrl`, so a backfilled level is never presented
 * as a stored snapshot.
 *
 * What the value is *not*: the capital store's `coreStablecoins.currentUsd` is USDT+USDC only, while
 * this public series is every USD-pegged asset. DefiLlama publishes no bounded per-asset history
 * (an individual asset's JSON is ~22 MB), so a backfill answers the wider series it can actually
 * read rather than inventing a core number. The observation instant travels with the value, so a
 * reader can see how old the point is and which series it came from.
 */

export const stablecoinHistoryAsOfPolicy = Object.freeze({
  method: 'historical-api',
  sourceUrl: 'https://stablecoins.llama.fi/stablecoincharts/all',
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  maximumSupplyUsd: Number.MAX_SAFE_INTEGER,
  dayMilliseconds: 24 * 60 * 60 * 1_000
})

export type StablecoinHistoryAsOfRequest = Readonly<{ asOf: string }>

export type StablecoinHistoryAsOfGapCode =
  | 'invalid-as-of'
  | 'future-as-of'
  /** No public history reader is wired in this build, so there is no interface to ask. */
  | 'historical-api-unavailable'
  /** The interface answered, but holds no point at or before the instant. */
  | 'historical-as-of-unavailable'
  | 'query-unavailable'

export type StablecoinHistoryAsOfReading = Readonly<{
  state: 'available'
  asOf: string
  value: number
  /** The instant of the point that answered, always at or before `asOf`. */
  observedAt: string
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

export type StablecoinHistoryAsOfDeps = Readonly<{
  /**
   * The existing DefiLlama history request. `undefined` means this build has no public history
   * client, which is `historical-api-unavailable` rather than a value or a silent skip.
   */
  requestHistory?: () => Promise<CapitalConditionsHttpResult>
  now?: () => number
}>

export function createStablecoinHistoryAsOf(deps: StablecoinHistoryAsOfDeps) {
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
      const requestHistory = deps.requestHistory
      if (!requestHistory) {
        return gap(asOf, 'historical-api-unavailable', 'no DefiLlama history client is wired in this build.')
      }
      let response: CapitalConditionsHttpResult
      try {
        response = await requestHistory()
      } catch {
        return gap(asOf, 'query-unavailable', 'the DefiLlama history request failed.')
      }
      if (response.state === 'unavailable') {
        return gap(asOf, 'query-unavailable', `the DefiLlama history request was refused (${response.reason}).`)
      }
      const points = supplyPoints(response.payload)
      if (!points) {
        return gap(asOf, 'query-unavailable', 'the DefiLlama history payload is not the expected supply series.')
      }
      let newestMs = Number.NEGATIVE_INFINITY
      for (const instantMs of points.keys()) {
        // A daily point stamped at day D belongs to D: DefiLlama keeps updating it during D, so it
        // is only a fact about a completed day once D has ended. That keeps a cutoff at D 00:00Z
        // from importing D's still-moving row, exactly as the ETF and FRED readers gate their days.
        if (instantMs + stablecoinHistoryAsOfPolicy.dayMilliseconds > asOfMs) continue
        if (instantMs > newestMs) newestMs = instantMs
      }
      if (!Number.isFinite(newestMs)) {
        return gap(asOf, 'historical-as-of-unavailable', 'the public stablecoin series holds no completed daily supply point by this instant.')
      }
      const value = points.get(newestMs)
      if (value === undefined || !isValidSupply(value)) {
        return gap(asOf, 'historical-as-of-unavailable', 'the public stablecoin point by this instant is not a readable supply.')
      }
      // Both the point and the instant it is stamped with are decided before the value is returned:
      // a point after the requested instant can never become an answer.
      const observedAt = new Date(newestMs).toISOString()
      if (observedAt > asOf) {
        return gap(asOf, 'historical-as-of-unavailable', `the public stablecoin observation ${observedAt} is newer than the requested instant.`)
      }
      return Object.freeze({
        state: 'available' as const,
        asOf,
        value,
        observedAt,
        sourceUrl: stablecoinHistoryAsOfPolicy.sourceUrl,
        method: stablecoinHistoryAsOfPolicy.method
      })
    }
  }
}

export type StablecoinHistoryAsOfQuery = ReturnType<typeof createStablecoinHistoryAsOf>

/**
 * Every day DefiLlama stamped with a supply, newest last in the payload.
 *
 * A row that does not carry an integer epoch second and a finite `totalCirculatingUSD.peggedUSD` is
 * skipped rather than allowed to poison the series: this is a public, long-lived response and one
 * malformed day must not turn a readable instant into a permanent gap. `undefined` means the payload
 * is not this response at all, which is a failed read rather than a missing point.
 */
function supplyPoints(payload: unknown): ReadonlyMap<number, number> | undefined {
  if (!Array.isArray(payload)) return undefined
  const points = new Map<number, number>()
  for (const value of payload) {
    const row = plainRecord(value)
    if (!row) continue
    const totals = plainRecord(row.totalCirculatingUSD)
    const supply = totals?.peggedUSD
    const epochSeconds = readEpochSeconds(row.date)
    if (epochSeconds === undefined || !isValidSupply(supply)) continue
    points.set(epochSeconds * 1_000, supply)
  }
  return points
}

function readEpochSeconds(value: unknown): number | undefined {
  const epochSeconds = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value) ? Number(value) : undefined
  return epochSeconds !== undefined && Number.isSafeInteger(epochSeconds) && epochSeconds >= 0 ? epochSeconds : undefined
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

function gap(asOf: string, gapCode: StablecoinHistoryAsOfGapCode, detail: string): StablecoinHistoryAsOfGap {
  return Object.freeze({ state: 'unavailable' as const, asOf, gapCode, detail })
}

function isCanonicalInstant(value: unknown): value is string {
  return typeof value === 'string' && stablecoinHistoryAsOfPolicy.canonicalUtcMillisPattern.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
