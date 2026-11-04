/**
 * Every path in the data area, computed in viewBox units — never in rendered pixels.
 *
 * The card is exported as an image and measured by assertions (vertex count equals plotted points,
 * two renders produce the same points, the first point sits at zero). Pixels depend on the card's
 * height, which other blocks can change; viewBox units do not. Keeping this arithmetic here, as pure
 * functions, is what makes those assertions stable and testable without a DOM.
 */

export const POLICY_GAUGE = Object.freeze({ width: 88, height: 54, cx: 44, cy: 44, radius: 34, stroke: 8 })
export const PRICE_AREA = Object.freeze({ width: 100, height: 70, zeroY: 35 })
export const OI_SPARK = Object.freeze({ width: 60, height: 26 })

/** One arc of the half dial: starts at the left end (−180°) and each segment takes its share. */
function arcPath(radius: number, cx: number, cy: number, fromDeg: number, toDeg: number): string {
  const point = (deg: number): readonly [number, number] => {
    const radians = (deg * Math.PI) / 180
    return [cx + radius * Math.cos(radians), cy + radius * Math.sin(radians)] as const
  }
  const [x1, y1] = point(fromDeg)
  const [x2, y2] = point(toDeg)
  const largeArc = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0
  return `M ${round(x1)} ${round(y1)} A ${radius} ${radius} 0 ${largeArc} 1 ${round(x2)} ${round(y2)}`
}

/**
 * The dial's segments, one to three of them.
 *
 * Each share is drawn in proportion; a share of zero draws nothing at all, so the same function serves
 * a two-segment dial today (the outcome and the rest) and a three-segment one once the distribution is
 * carried by the document — the layout does not change when that data arrives.
 */
export function policyGaugeArcs(shares: readonly number[]): readonly string[] {
  const { cx, cy, radius } = POLICY_GAUGE
  const clamped = shares.map((share) => clamp(share, 0, 100))
  const total = clamped.reduce((sum, share) => sum + share, 0)
  // Guard against a caller passing shares that already add to more than the dial.
  const normalised = total > 100 ? clamped.map((share) => (share / total) * 100) : clamped
  const paths: string[] = []
  let fromDeg = -180
  for (const share of normalised) {
    if (share <= 0) continue
    const toDeg = fromDeg + (share / 100) * 180
    paths.push(arcPath(radius, cx, cy, fromDeg, toDeg))
    fromDeg = toDeg
  }
  return Object.freeze(paths)
}

/** The dial's empty track: one full half circle, drawn under the segments. */
export function policyGaugeTrack(): string {
  const { cx, cy, radius } = POLICY_GAUGE
  return arcPath(radius, cx, cy, -180, 0)
}

/**
 * The filled area of a price row, above the zero axis only.
 *
 * Points are clamped to `zeroY` rather than intersected: a segment that dips below zero simply stops
 * at the axis, which is what "fill only above zero" means. When every point is at or below zero the
 * area is empty and the caller draws nothing — a flat band at the axis would claim the market moved.
 */
export function priceAreaPath(values: readonly number[]): string {
  if (values.length < 2) return ''
  const { width, height, zeroY } = PRICE_AREA
  const max = Math.max(...values.map(Math.abs), 0)
  if (max === 0) return ''
  const step = width / (values.length - 1)
  const xs = values.map((_, index) => round(index * step))
  const ys = values.map((value) => round(clamp(zeroY - (value / max) * (height / 2 - 1), 0, zeroY)))
  const above = ys.some((y, index) => y < zeroY && values[index]! > 0)
  if (!above) return ''
  return `M ${xs[0]} ${zeroY} ${xs.map((x, index) => `L ${x} ${ys[index]}`).join(' ')} L ${xs.at(-1)} ${zeroY} Z`
}

/** The polyline for the same points, so the line and its fill can never disagree. */
export function priceLinePoints(values: readonly number[]): string {
  if (values.length < 2) return ''
  const { width, height, zeroY } = PRICE_AREA
  const max = Math.max(...values.map(Math.abs), 0)
  if (max === 0) return ''
  const step = width / (values.length - 1)
  return values
    .map((value, index) => `${round(index * step)},${round(clamp(zeroY - (value / max) * (height / 2 - 1), 0, height))}`)
    .join(' ')
}

/** The open-interest sparkline: shape only, normalized per row. */
export function oiSparkPoints(values: readonly number[]): string {
  if (values.length < 2) return ''
  const { width, height } = OI_SPARK
  const min = Math.min(...values)
  const max = Math.max(...values)
  const step = width / (values.length - 1)
  // A flat series draws its middle line: with min === max every point lands at the centre, which is a
  // line the reader can see rather than a division by zero.
  const y = (value: number): number => (max === min ? height / 2 : height - ((value - min) / (max - min)) * height)
  return values.map((value, index) => `${round(index * step)},${round(y(value))}`).join(' ')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Two decimals keep the coordinates stable across runs, which "same points twice" depends on. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}
