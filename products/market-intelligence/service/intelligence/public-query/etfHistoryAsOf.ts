import { zeroXRouterSourcePolicy } from '../application/zeroXRouterSourcePolicy'
import type { EtfFlowHistoryRow } from '../etf/etfFlowHistoryParser'

/**
 * The ETF daily net flow as of an instant, from the provider's own flow history.
 *
 * Why this exists: the capital store answers ETF flows from the window the last refresh stored. A
 * briefing frozen at its 00:00Z cutoff and generated after the machine started at 04:48Z has no
 * stored row at or before the cutoff, so both ETF rows print a gap even though the provider's flow
 * history does cover the trading days the cutoff could see. The backfill tool asks this reader only
 * after the local snapshot has no row at or before the instant; a stored row always wins.
 *
 * Which series answers: the same 0xRouter `flow-history` endpoint the current-state refresh already
 * consumes, through that refresh's client (one API key, one governance queue, the platform's
 * proxy-aware fetch) — no second transport, no raw fetch. The answer is the newest trading day that
 * had *ended* by `asOf`: a daily flow for day D is the flow of D, so it is known once D is over in
 * UTC and never before. That is what keeps a cutoff at D 00:00Z from reporting D's partial flow, and
 * what lets the same cutoff keep D-1's official flow.
 *
 * When no interface is available — no client wired, no credential configured, or the source switched
 * off — the answer is `historical-api-unavailable`. When the provider answered but holds nothing at or before the
 * instant, it is `historical-as-of-unavailable`. Neither is ever filled with a number.
 */

export const etfHistoryAsOfPolicy = Object.freeze({
  method: 'historical-api',
  dayMilliseconds: 24 * 60 * 60 * 1_000,
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  sourceUrl: Object.freeze({
    btc: zeroXRouterSourcePolicy.etfFlowHistoryDiagnostic.urls.bitcoin,
    eth: zeroXRouterSourcePolicy.etfFlowHistoryDiagnostic.urls.ethereum
  })
})

export type EtfHistoryAsset = 'btc' | 'eth'

export type EtfHistoryAsOfRequest = Readonly<{ asset: EtfHistoryAsset; asOf: string }>

export type EtfHistoryAsOfGapCode =
  | 'invalid-as-of'
  | 'future-as-of'
  | 'unknown-asset'
  /** No public history reader is wired in this build, so there is no interface to ask. */
  | 'historical-api-unavailable'
  /** The interface answered, but holds no row at or before the instant. */
  | 'historical-as-of-unavailable'
  | 'query-unavailable'

export type EtfHistoryAsOfReading = Readonly<{
  state: 'available'
  asset: EtfHistoryAsset
  asOf: string
  value: number
  /** The trading day the flow belongs to. */
  tradingDate: string
  /** The instant that day ended, which is when the flow became known. */
  observedAt: string
  sourceUrl: string
  method: typeof etfHistoryAsOfPolicy.method
}>

export type EtfHistoryAsOfGap = Readonly<{
  state: 'unavailable'
  asset: string
  asOf: string
  gapCode: EtfHistoryAsOfGapCode
  detail: string
}>

export type EtfHistoryAsOfResult = EtfHistoryAsOfReading | EtfHistoryAsOfGap

/**
 * What the provider's client answered. `not-configured` is the wiring's way of saying there is no
 * credential or client to call, which is a missing interface rather than a failed request.
 */
export type EtfHistoryApiWindow =
  | Readonly<{ state: 'available'; btc?: readonly EtfFlowHistoryRow[]; eth?: readonly EtfFlowHistoryRow[] }>
  | Readonly<{ state: 'partial'; btc?: readonly EtfFlowHistoryRow[]; eth?: readonly EtfFlowHistoryRow[] }>
  | Readonly<{ state: 'unavailable' }>
  | Readonly<{ state: 'not-configured' }>

export type EtfHistoryAsOfDeps = Readonly<{
  /**
   * The existing ETF flow-history request. `undefined` means this build has no provider client,
   * which is `historical-api-unavailable` rather than a value or a silent skip. One edition asks at
   * most twice (BTC and ETH), so the window is requested once and shared.
   */
  requestWindow?: () => Promise<EtfHistoryApiWindow>
  now?: () => number
}>

export function createEtfHistoryAsOf(deps: EtfHistoryAsOfDeps) {
  let requested: Promise<EtfHistoryApiWindow> | undefined

  function windowOnce(): Promise<EtfHistoryApiWindow> {
    const requestWindow = deps.requestWindow
    if (!requestWindow) return Promise.resolve(Object.freeze({ state: 'not-configured' as const }))
    if (!requested) {
      // A failed window is not cached: the next metric of the same edition may try again, and a
      // failure must not be replayed as if it were an answer.
      requested = requestWindow().catch((error: unknown) => {
        requested = undefined
        throw error
      })
    }
    return requested
  }

  return {
    async read(request: EtfHistoryAsOfRequest): Promise<EtfHistoryAsOfResult> {
      const asset = request?.asset
      const asOf = typeof request?.asOf === 'string' ? request.asOf.trim() : ''
      if (!isCanonicalInstant(asOf)) {
        return gap(asset, asOf, 'invalid-as-of', 'asOf must be a canonical UTC instant, for example 2026-10-30T00:00:00.000Z.')
      }
      const asOfMs = Date.parse(asOf)
      const nowMs = (deps.now ?? Date.now)()
      if (!Number.isFinite(nowMs) || asOfMs > nowMs) {
        return gap(asset, asOf, 'future-as-of', 'asOf is after the current time; a historical read may not answer the future.')
      }
      if (asset !== 'btc' && asset !== 'eth') {
        return gap(asset, asOf, 'unknown-asset', `no ETF flow history answers the asset ${String(asset)}.`)
      }
      let window: EtfHistoryApiWindow
      try {
        window = await windowOnce()
      } catch {
        return gap(asset, asOf, 'query-unavailable', 'the ETF flow-history request failed.')
      }
      if (window.state === 'not-configured') {
        return gap(asset, asOf, 'historical-api-unavailable', 'no 0xRouter ETF flow-history client is configured or enabled in this build.')
      }
      if (window.state === 'unavailable') {
        return gap(asset, asOf, 'query-unavailable', 'the ETF flow-history request was refused.')
      }
      const rows = asset === 'btc' ? window.btc : window.eth
      if (!rows || rows.length === 0) {
        // A partial window means the other asset's request failed, so this asset was never answered;
        // an empty series on an answered window means the provider simply holds no rows.
        return window.state === 'partial'
          ? gap(asset, asOf, 'query-unavailable', 'the ETF flow-history request for this asset was refused.')
          : gap(asset, asOf, 'historical-as-of-unavailable', 'the ETF flow history holds no row for this asset.')
      }
      const flow = newestFlowAt(rows, asOfMs)
      if (!flow) {
        return gap(asset, asOf, 'historical-as-of-unavailable', 'the ETF flow history holds no trading day that had ended by this instant.')
      }
      const observedAt = `${flow.tradingDate}T00:00:00.000Z`
      if (observedAt > asOf) {
        return gap(asset, asOf, 'historical-as-of-unavailable', `the ETF flow observation ${observedAt} is newer than the requested instant.`)
      }
      return Object.freeze({
        state: 'available' as const,
        asset,
        asOf,
        value: flow.value,
        tradingDate: flow.tradingDate,
        observedAt,
        sourceUrl: etfHistoryAsOfPolicy.sourceUrl[asset],
        method: etfHistoryAsOfPolicy.method
      })
    }
  }
}

export type EtfHistoryAsOfQuery = ReturnType<typeof createEtfHistoryAsOf>

/**
 * The newest daily flow whose trading day had ended by the instant.
 *
 * The provider stamps each row with the instant its trading day began, so the day-end gate is the
 * row's own date plus one day. A row that is not stamped exactly at a UTC midnight is not a daily
 * flow this reader can place, and a day the provider contradicts itself about is skipped rather than
 * resolved by row order — the same rule the current-state window applies.
 */
function newestFlowAt(rows: readonly EtfFlowHistoryRow[], asOfMs: number): Readonly<{ tradingDate: string; value: number }> | undefined {
  const byTradingDate = new Map<string, number | undefined>()
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const dateMs = row.date
    if (typeof dateMs !== 'number' || !Number.isSafeInteger(dateMs) || Math.abs(dateMs) > 8_640_000_000_000_000) continue
    const date = new Date(dateMs)
    if (!Number.isFinite(date.getTime()) || date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0 || date.getUTCSeconds() !== 0 || date.getUTCMilliseconds() !== 0) continue
    if (typeof row.changeUsd !== 'number' || !Number.isFinite(row.changeUsd)) continue
    // Day D's flow is the flow of D: it is known once D is over, never before.
    if (dateMs + etfHistoryAsOfPolicy.dayMilliseconds > asOfMs) continue
    const tradingDate = date.toISOString().slice(0, 10)
    const previous = byTradingDate.get(tradingDate)
    if (previous === undefined && !byTradingDate.has(tradingDate)) byTradingDate.set(tradingDate, row.changeUsd)
    else if (previous !== row.changeUsd) byTradingDate.set(tradingDate, undefined)
  }
  const tradingDates = [...byTradingDate.entries()]
    .filter(([, value]) => value !== undefined)
    .map(([tradingDate, value]) => ({ tradingDate, value: value! }))
    .sort((left, right) => left.tradingDate.localeCompare(right.tradingDate))
  return tradingDates.at(-1)
}

function gap(asset: unknown, asOf: string, gapCode: EtfHistoryAsOfGapCode, detail: string): EtfHistoryAsOfGap {
  return Object.freeze({ state: 'unavailable' as const, asset: String(asset ?? ''), asOf, gapCode, detail })
}

function isCanonicalInstant(value: unknown): value is string {
  return typeof value === 'string' && etfHistoryAsOfPolicy.canonicalUtcMillisPattern.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
