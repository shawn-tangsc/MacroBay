import { isWithinUtf8JsonBudget } from '../../../contracts/intelligenceQueryContracts'
import {
  isCanonicalOpenInterestTime,
  isOpenInterestChange,
  isOpenInterestSeries,
  isOpenInterestWindow,
  openInterestHistoryPolicy,
  openInterestUnavailable,
  type OpenInterestChange,
  type OpenInterestHistoryResult,
  type OpenInterestPoint,
  type OpenInterestWindow
} from '../../../contracts/openInterestHistory'
import { detectLiquidationHints, liquidationHintPolicy, type PositioningBar } from '../../../contracts/openInterestPositioning'
import type { PerpetualPositioningStore, PositioningStoredBar } from '../store/perpetualPositioningStore'

const BUCKET_MS = 900_000

/**
 * Reads the positioning series and shapes it for one window.
 *
 * The 7-day view is folded here rather than stored: the same 15-minute rows answer both
 * windows, so there is one history and two readings. Folding groups by UTC hour and keeps the
 * hour's last bucket, stamped at the hour's start — the value is the newest reading inside
 * that hour, which is why the last point can describe a bucket up to 45 minutes newer than
 * its own timestamp.
 *
 * The liquidation read needs 96 buckets of volume before each candidate, so the store is asked
 * for the window plus that lookback; marks outside the window are dropped afterwards.
 */
export async function queryOpenInterestHistoryAsync(input: Readonly<{
  asOf: string
  window: unknown
  store: Pick<PerpetualPositioningStore, 'read'>
}>): Promise<OpenInterestHistoryResult> {
  if (!isCanonicalOpenInterestTime(input.asOf) || !isOpenInterestWindow(input.window)) return openInterestUnavailable()
  const window: OpenInterestWindow = input.window
  try {
    const { resolution, maximumPointsPerAsset } = openInterestHistoryPolicy.windows[window]
    const windowBars = resolution === '1h' ? openInterestHistoryPolicy.windows['7d'].spanMs / BUCKET_MS : openInterestHistoryPolicy.windows['24h'].spanMs / BUCKET_MS
    const read = await input.store.read({ asOf: input.asOf, bars: windowBars + liquidationHintPolicy.lookbackBars })
    if (read.state === 'unavailable') return openInterestUnavailable()
    if (read.state === 'empty') return { state: 'empty', asOf: input.asOf, window }

    const asOfMs = Date.parse(input.asOf)
    const btc = project(read.btc, window, asOfMs, maximumPointsPerAsset)
    const eth = project(read.eth, window, asOfMs, maximumPointsPerAsset)
    if (btc === undefined || eth === undefined) return openInterestUnavailable()

    const change = changeOf(read.btc, read.eth)
    const hints = [
      detect(read.btc, 'btc', asOfMs, window),
      detect(read.eth, 'eth', asOfMs, window)
    ]
    const hintsState = hints.some(entry => entry.state === 'unavailable') ? 'unavailable' as const : 'available' as const
    const usableHints = hints.flatMap(entry => entry.hints).sort((left, right) => left.observedAt.localeCompare(right.observedAt))
    const truncated = hints.some(entry => entry.truncated)

    const output: OpenInterestHistoryResult = {
      state: 'available',
      asOf: input.asOf,
      window,
      btc: btc.points,
      eth: eth.points,
      ...(change ? { change } : {}),
      ...(usableHints.length > 0 ? { liquidationHints: Object.freeze(usableHints.slice(-openInterestHistoryPolicy.maximumLiquidationHints)) } : {}),
      ...(truncated || usableHints.length > openInterestHistoryPolicy.maximumLiquidationHints ? { liquidationHintsTruncated: true } : {}),
      liquidationHintsState: hintsState
    }
    return isWithinUtf8JsonBudget(output, openInterestHistoryPolicy.maximumDtoBytes) ? output : openInterestUnavailable()
  } catch {
    return openInterestUnavailable()
  }
}

type Projected = Readonly<{ points: readonly OpenInterestPoint[]; windowRows: readonly PositioningStoredBar[] }>

function project(rows: readonly PositioningStoredBar[], window: OpenInterestWindow, asOfMs: number, maximum: number): Projected | undefined {
  const inWindow = rows.slice(-Math.floor((window === '7d' ? openInterestHistoryPolicy.windows['7d'].spanMs : openInterestHistoryPolicy.windows['24h'].spanMs) / BUCKET_MS))
  if (inWindow.length === 0) return { points: [], windowRows: [] }
  const points = openInterestHistoryPolicy.windows[window].resolution === '1h' ? foldToHours(inWindow) : inWindow.map(toPoint)
  if (!isOpenInterestSeries(points, new Date(asOfMs).toISOString())) return undefined
  if (points.length > maximum) return undefined
  return { points, windowRows: inWindow }
}

function foldToHours(rows: readonly PositioningStoredBar[]): readonly OpenInterestPoint[] {
  const byHour = new Map<number, PositioningStoredBar>()
  for (const row of rows) {
    const hour = Math.floor(Date.parse(row.observedAt) / 3_600_000) * 3_600_000
    const current = byHour.get(hour)
    if (!current || row.observedAt > current.observedAt) byHour.set(hour, row)
  }
  return [...byHour.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([hour, row]) => Object.freeze({ observedAt: new Date(hour).toISOString(), notionalUsd: row.notionalUsd }))
}

function toPoint(row: PositioningStoredBar): OpenInterestPoint {
  return Object.freeze({ observedAt: row.observedAt, notionalUsd: row.notionalUsd })
}

/**
 * Changes are read from the native 15-minute rows, not from the folded points: folding moves
 * the newest reading up to 45 minutes earlier, and a 1-hour change computed off a folded point
 * would quietly describe a different hour.
 */
function changeOf(btc: readonly PositioningStoredBar[], eth: readonly PositioningStoredBar[]): Readonly<Record<'btc' | 'eth', OpenInterestChange>> | undefined {
  const btcChange = changeFor(btc)
  const ethChange = changeFor(eth)
  if (!btcChange && !ethChange) return undefined
  return { btc: btcChange ?? {}, eth: ethChange ?? {} }
}

function changeFor(rows: readonly PositioningStoredBar[]): OpenInterestChange | undefined {
  const latest = rows.at(-1)
  if (!latest) return undefined
  const latestMs = Date.parse(latest.observedAt)
  const at = (ms: number) => rows.find(row => Date.parse(row.observedAt) === ms)?.notionalUsd
  const change: { h1Pct?: number; h24Pct?: number } = {}
  const h1 = at(latestMs - openInterestHistoryPolicy.changeWindowsMs.h1)
  const h24 = at(latestMs - openInterestHistoryPolicy.changeWindowsMs.h24)
  if (h1 !== undefined) {
    const value = percentChange(h1, latest.notionalUsd)
    if (isOpenInterestChange(value)) change.h1Pct = round(value)
  }
  if (h24 !== undefined) {
    const value = percentChange(h24, latest.notionalUsd)
    if (isOpenInterestChange(value)) change.h24Pct = round(value)
  }
  if (change.h1Pct === undefined && change.h24Pct === undefined) return undefined
  return change
}

/**
 * Only closed buckets are judged, and only marks inside the window are reported. A bucket is
 * closed once its 15 minutes have elapsed; the newest one usually has not.
 */
function detect(rows: readonly PositioningStoredBar[], asset: 'btc' | 'eth', asOfMs: number, window: OpenInterestWindow) {
  const closed = rows.filter(row => Date.parse(row.observedAt) + BUCKET_MS <= asOfMs)
  const bars: PositioningBar[] = closed.map(row => Object.freeze({
    observedAt: row.observedAt,
    notionalUsd: row.notionalUsd,
    volumeBase: row.volumeBase,
    closePrice: row.closePrice
  }))
  const result = detectLiquidationHints({ asset, bars })
  const from = asOfMs - (window === '7d' ? openInterestHistoryPolicy.windows['7d'].spanMs : openInterestHistoryPolicy.windows['24h'].spanMs)
  return {
    state: result.state,
    truncated: result.truncated,
    hints: result.hints.filter(hint => Date.parse(hint.observedAt) >= from)
  }
}

function percentChange(from: number, to: number): number {
  if (!(from > 0)) return Number.NaN
  return ((to - from) / from) * 100
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
