import { macroMarketSnapshotPublicPolicy } from '../../../contracts/macro/macroMarketSnapshotContracts'
import type { CrossAssetMacroProxyId } from '../../../contracts/crossAssetObservationContracts'

/**
 * One macro instrument read as a same-anchor return curve, beside the crypto rows it is compared with.
 *
 * The cross-asset curves are matched bar for bar: their source is one exchange publishing a five-minute
 * close for every instant on the grid, so a missing point there is news. The macro series is not that.
 * It is assembled from three providers on three cadences — the licensed dollar and gold on five-minute
 * bars, the basket's currencies on fifteen, and the deep pages this product asks for once on hourly and
 * four-hourly bars — so requiring an exact bar at every hourly instant would draw a dashed line over
 * history that is really there, and it would leave most of the seven-day window blank.
 *
 * So the macro curves read the newest close **at or before** each instant, and the anchor is the newest
 * close at or before the window start. Two bounds keep that from becoming invention:
 *
 * - A value is carried for at most {@link crossAssetMacroCurvePolicy.maxCarryMs}. Beyond it the price at
 *   that instant is simply not known — a weekend, a dead feed, a market that was shut — and the curve
 *   says `null` rather than drawing a straight line through it.
 * - The anchor may sit up to {@link crossAssetMacroCurvePolicy.anchorLookbackMs} before the window start,
 *   because a seven-day window that begins on a Sunday would otherwise have no base at all: the dollar
 *   had not traded since Friday. The base is therefore the last close before the window, not a value
 *   invented at its edge.
 */
export const crossAssetMacroCurvePolicy = Object.freeze({
  /**
   * Which series may answer each macro line, best candidate first — the same order, from the same
   * contract, that the 市场状态 table's own rows resolve their readings with. Nothing else may draw a
   * macro line: a fabricated dollar curve would be worse than an absent one.
   */
  proxies: Object.freeze({
    dxy: macroMarketSnapshotPublicPolicy.dollarIndexPreference,
    gold: Object.freeze([macroMarketSnapshotPublicPolicy.series.gold])
  } as const),
  maxCarryMs: 24 * 3_600_000,
  anchorLookbackMs: 3 * 24 * 3_600_000,
  percentFactor: 100
})

export type CrossAssetMacroPoint = Readonly<{ atMs: number; value: number }>
/** One candidate series for one line, newest last, exactly as the store returns a series. */
export type CrossAssetMacroCandidate = Readonly<{ seriesId: string; points: readonly CrossAssetMacroPoint[] }>
export type CrossAssetMacroCurvePoint = Readonly<{ atMs: number; returnPercent: number | null }>

export type CrossAssetMacroCurvesInput = Readonly<{
  candidates: Readonly<Record<CrossAssetMacroProxyId, readonly CrossAssetMacroCandidate[]>>
  windowStartMs: number
  /** How many points the wire carries for this range: 13, 289 or 169. */
  count: number
  /** The grid's own spacing: one interval, or an hour across the seven-day window. */
  strideMs: number
}>

/** The newest close at or before an instant, whatever its age: the caller decides what age it admits. */
function lastAtOrBefore(candidate: CrossAssetMacroCandidate, atMs: number): CrossAssetMacroPoint | undefined {
  let found: CrossAssetMacroPoint | undefined
  for (const point of candidate.points) {
    if (point.atMs > atMs) break
    found = point
  }
  return found
}

/**
 * The candidate that can anchor the window, and the close it anchors on: the first in preference order
 * whose last close before the window start is recent enough to serve as the base.
 *
 * The anchor's own age is judged by {@link crossAssetMacroCurvePolicy.anchorLookbackMs} and nothing else.
 * It is deliberately more forgiving than the carry rule inside the window: a seven-day window that opens
 * on a Sunday needs Friday's close to have any base at all, and that is a real close, not a carried one.
 * A series that only begins inside the window cannot anchor it, and is skipped rather than allowed to
 * start the line at an arbitrary instant — the point of these curves is that every zero is the same one.
 */
function anchorOf(
  candidates: readonly CrossAssetMacroCandidate[], windowStartMs: number
): Readonly<{ candidate: CrossAssetMacroCandidate; anchor: CrossAssetMacroPoint }> | undefined {
  for (const candidate of candidates) {
    const base = lastAtOrBefore(candidate, windowStartMs)
    if (base !== undefined && windowStartMs - base.atMs <= crossAssetMacroCurvePolicy.anchorLookbackMs && base.value > 0) {
      return { candidate, anchor: base }
    }
  }
  return undefined
}

export function crossAssetMacroCurves(
  input: CrossAssetMacroCurvesInput
): Record<CrossAssetMacroProxyId, readonly CrossAssetMacroCurvePoint[]> {
  const proxies = Object.keys(crossAssetMacroCurvePolicy.proxies) as CrossAssetMacroProxyId[]
  return Object.fromEntries(proxies.map((proxy) => {
    const anchored = anchorOf(input.candidates[proxy] ?? [], input.windowStartMs)
    if (!anchored) return [proxy, Object.freeze([])]
    const { anchor } = anchored
    const points = Array.from({ length: input.count }, (_, index) => {
      const atMs = input.windowStartMs + index * input.strideMs
      const point = lastAtOrBefore(anchored.candidate, atMs)
      if (point === undefined || atMs - point.atMs > crossAssetMacroCurvePolicy.maxCarryMs) {
        return Object.freeze({ atMs, returnPercent: null })
      }
      const percent = crossAssetMacroCurvePolicy.percentFactor * (point.value / anchor.value - 1)
      return Object.freeze({ atMs, returnPercent: Object.is(percent, -0) ? 0 : percent })
    })
    return [proxy, Object.freeze(points)]
  })) as Record<CrossAssetMacroProxyId, readonly CrossAssetMacroCurvePoint[]>
}
