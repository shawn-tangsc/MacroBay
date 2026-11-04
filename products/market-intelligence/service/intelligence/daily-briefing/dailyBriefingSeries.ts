import type { BriefingCurveReason, BriefingCurveSegment, BriefingSeriesPoint } from '../../../contracts/dailyBriefing'

/**
 * What the data region's two drawings are made of.
 *
 * Both curves were already in hand when the edition was built — the open interest read carries a
 * fifteen-minute series and the cross-asset snapshot carries a five-minute return curve — and both
 * were thrown away by the document layer, which kept only the last point. This module is the one
 * place that turns those reads into what the document stores: sampled, rebased, split at gaps.
 *
 * Three rules come from the design and are implemented here rather than in a renderer, because a
 * renderer cannot see the source:
 *
 * - Sampling is deterministic and happens once, at build time. Two renders of one document must draw
 *   the same line, so nothing downstream may thin again.
 * - A missing reading is a gap, never a zero. A zero would draw a line through minutes nobody
 *   measured, and a reader cannot tell that from a real move to zero.
 * - The price curve is a return from the window's own start, so it is rebased before it is thinned.
 *   Thinning first would drop the anchor and leave a line that starts at some arbitrary value.
 */

export const briefingSeriesPolicy = Object.freeze({
  /**
   * Points the document keeps per price curve. The source grid is five minutes, about 289 points for
   * a day; a hundred-pixel column cannot show them, and a fixed cap keeps two window widths printing
   * the same shape instead of a pixel-dependent one.
   */
  priceMaximumPoints: 48,
  /** Points the document keeps per open interest series. Same reasoning, a much smaller drawing. */
  openInterestMaximumPoints: 24,
  /** The longest reader window the 24-hour curve can answer honestly. */
  priceWindowMaximumHours: 24
})

/** The curve fields of one price row: the segments to draw, or the reason there are none. */
export type BriefingPriceCurve = Readonly<{
  curve?: readonly BriefingCurveSegment[]
  curveReason?: BriefingCurveReason
}>

/**
 * Take the last point of each equally spaced bucket.
 *
 * The open interest card's number is the newest amount, so the sampled series has to end on it: the
 * final bucket's end *is* the last point. Averaging or taking the first point of a bucket would move
 * the line away from the amount printed beside it.
 */
export function sampleBucketEnds<T>(points: readonly T[], maximum: number): readonly T[] {
  if (points.length <= maximum) return points.slice()
  const sampled: T[] = []
  for (let bucket = 0; bucket < maximum; bucket += 1) {
    const index = Math.floor(((bucket + 1) * points.length) / maximum) - 1
    const point = points[index]
    if (point !== undefined && sampled.at(-1) !== point) sampled.push(point)
  }
  return sampled
}

/**
 * Keep both ends and space the rest evenly.
 *
 * A curve's first point is the window's anchor and its last point is "now"; dropping either one moves
 * where the drawing starts and ends, which is the one thing a reader compares across editions.
 */
export function sampleSpan<T>(points: readonly T[], maximum: number): readonly T[] {
  if (points.length <= maximum) return points.slice()
  const step = (points.length - 1) / (maximum - 1)
  const sampled: T[] = []
  let previous = -1
  for (let slot = 0; slot < maximum; slot += 1) {
    const index = Math.round(slot * step)
    if (index === previous) continue
    const point = points[index]
    if (point !== undefined) sampled.push(point)
    previous = index
  }
  return sampled
}

/**
 * The price curve of one card, ready to store.
 *
 * The window is the edition's own, not the reader's current setting: an edition that already exists
 * must keep meaning the window it was generated for. Filtering alone is not enough — every point of
 * the source curve is a return against the *24-hour* anchor, so a shorter window is rebased against
 * the first point it keeps, which makes that point zero in the stored data instead of somewhere near
 * zero on screen.
 */
export function briefingPriceCurve(input: Readonly<{
  points: readonly Readonly<{ at: string; returnPercent: number | null }>[] | undefined
  windowStart: string
  windowEnd: string
  windowHours: number
}>): BriefingPriceCurve {
  if (input.windowHours > briefingSeriesPolicy.priceWindowMaximumHours) {
    // The snapshot is always read as a 24-hour window. Printing it under a 48-hour heading would be
    // two different time spans wearing one title, so the card states the curve is not applicable.
    return { curveReason: 'window-too-long' }
  }
  const points = input.points
  if (!points) return { curveReason: 'no-snapshot' }
  const inWindow = points.filter((point) => point.at >= input.windowStart && point.at <= input.windowEnd)
  const anchor = inWindow.find((point) => typeof point.returnPercent === 'number')
  if (!anchor || typeof anchor.returnPercent !== 'number') return { curveReason: 'no-anchor' }
  const base = 1 + anchor.returnPercent / 100
  const rebased = inWindow.map((point) => typeof point.returnPercent === 'number'
    ? Object.freeze({ at: point.at, returnPercent: roundPercent((((1 + point.returnPercent / 100) / base) - 1) * 100) })
    : null)
  return storedSegments(sampleSpan(rebased, briefingSeriesPolicy.priceMaximumPoints))
}

/**
 * The open interest series of one card, or nothing when it cannot be drawn.
 *
 * `state` on the leverage block already separates "the read failed" from "the read succeeded with too
 * few points", so this returns only what can be drawn and lets the block's own state carry the rest.
 */
export function briefingOpenInterestSeries(
  points: readonly Readonly<{ observedAt: string; notionalUsd: number }>[]
): readonly BriefingSeriesPoint[] | undefined {
  const sampled = sampleBucketEnds(points, briefingSeriesPolicy.openInterestMaximumPoints)
    .filter((point) => Number.isFinite(point.notionalUsd) && point.notionalUsd >= 0)
  if (sampled.length < 2) return undefined
  return Object.freeze(sampled.map((point) => Object.freeze({ at: point.observedAt, value: point.notionalUsd })))
}

/** Split the sampled sequence at its missing readings and keep only the stretches that can be drawn. */
function storedSegments(sampled: readonly (Readonly<{ at: string; returnPercent: number }> | null)[]): BriefingPriceCurve {
  const segments: (readonly Readonly<{ at: string; returnPercent: number }>[])[] = []
  let current: Readonly<{ at: string; returnPercent: number }>[] = []
  for (const point of sampled) {
    if (point === null) {
      if (current.length > 0) segments.push(current)
      current = []
    } else {
      current.push(point)
    }
  }
  if (current.length > 0) segments.push(current)
  // One point is not a line: a segment shorter than that is a gap with a value in it.
  const drawable = segments.filter((segment) => segment.length >= 2)
  if (drawable.length === 0) return { curveReason: 'too-few-points' }
  return { curve: Object.freeze(drawable.map((segment) => Object.freeze(segment))) }
}

/** Percent, two decimals: smaller than the drawing can resolve and short enough for the document cap. */
function roundPercent(value: number): number {
  const rounded = Math.round(value * 100) / 100
  return rounded === 0 ? 0 : rounded
}
