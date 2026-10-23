import {
  macroMarketSnapshotPublicPolicy,
  type MacroMarketWindow
} from '../../../contracts/macro/macroMarketSnapshotContracts'
import type { MacroMarketStore } from './macroMarketStore'

export type { MacroMarketWindow }

/**
 * The windows this producer computes returns for.
 *
 * It is not a second list: it *is* the wire contract's array, so the main process that builds the
 * snapshot and the renderer that validates it read one definition. Hand-maintaining a copy here is
 * what broke the dashboard — the wire narrowed to `15m/1h/24h/7d` in one process while a still-running
 * main process kept emitting `4h`, and the fail-closed parser voided every reading rather than one
 * window. The contract owns the vocabulary; this module owns only the arithmetic (`windowMs`).
 */
export const macroMarketWindows: readonly MacroMarketWindow[] = macroMarketSnapshotPublicPolicy.windows
const windowMs: Readonly<Record<MacroMarketWindow, number>> = Object.freeze({
  '15m': 15 * 60_000, '1h': 3_600_000, '4h': 4 * 3_600_000, '24h': 24 * 3_600_000, '7d': 7 * 24 * 3_600_000
})

export type MacroMarketReturn = Readonly<{ state: 'available'; percent: number } | { state: 'unavailable'; reason: 'missing' | 'insufficient' }>

/**
 * The longest window the wire admits, in milliseconds.
 *
 * Both collectors size their backfill from this rather than from a number of their own. A hundred
 * fifteen-minute bars was "a little over the longest window" while the ladder stopped at 24h; when
 * the contract admitted `7d` that arithmetic became a day of history wearing a week's expectation,
 * which is why the 7d cell read 无数据 on a fresh profile and stayed that way for days.
 */
export function macroMarketLongestWindowMs(): number {
  return Math.max(...macroMarketWindows.map(window => windowMs[window]))
}

/** The bars one backfill has to ask for to cover that window at the given bar interval. */
export function macroMarketBackfillBars(barMs: number): number {
  return Math.ceil(macroMarketLongestWindowMs() / barMs)
}

/**
 * Whether a series' stored span is too short to answer the longest window at all.
 *
 * Measured in time, never in points: a market that closes for the weekend stores five days of bars
 * per calendar week, so a point count would call a healthy week thin forever and turn every tick
 * into a backfill that changes nothing. The threshold is half the longest window because that is the
 * margin `macroMarketReturn` accepts around its anchor; below it the window is definitely blank.
 */
export function macroMarketHistoryIsThin(store: MacroMarketStore, seriesId: string): boolean {
  const latest = store.latest(seriesId)
  const earliest = store.earliest(seriesId)
  if (!latest || !earliest) return true
  return latest.atMs - earliest.atMs < macroMarketLongestWindowMs() / 2
}

/**
 * Percent change over a window, from the stored series.
 *
 * The older point must be the one the clock asks for — if the series is missing a bar near the
 * window start, the answer is `insufficient` rather than the return since whenever the last bar
 * happened to land. Hidden gaps are how a "24h" figure silently becomes a 30-hour figure.
 */
export function macroMarketReturn(store: MacroMarketStore, seriesId: string, window: MacroMarketWindow): MacroMarketReturn {
  const latest = store.latest(seriesId)
  if (!latest) return { state: 'unavailable', reason: 'missing' }
  // Anchored on the newest bar rather than on "now": a series collected a few minutes ago would
  // otherwise be unable to answer its own shortest window, even though the change is right there in
  // the data. How fresh the series is shows up separately, as the last update time.
  const target = latest.atMs - windowMs[window]
  // The bar we compare against has to sit close to the window start; half a window is the margin
  // that still means "this is the change over the window" rather than "over whatever we had".
  const tolerance = windowMs[window] / 2
  const older = [...store.series(seriesId, target - tolerance, target + tolerance)].sort((a, b) => Math.abs(a.atMs - target) - Math.abs(b.atMs - target))[0]
  if (!older || latest.atMs <= older.atMs || older.value === 0) return { state: 'unavailable', reason: 'insufficient' }
  return { state: 'available', percent: (latest.value / older.value - 1) * 100 }
}
