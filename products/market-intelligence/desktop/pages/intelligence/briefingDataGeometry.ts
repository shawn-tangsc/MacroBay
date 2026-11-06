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
 * One arc's role. A two-segment dial names its second arc `residual` ("not the event"); a three-segment
 * one names the small leftover `other` ("the rest of the board"), which is a different claim.
 */
export type PolicyGaugeSegmentOutcome = 'event' | 'hold' | 'other' | 'residual'
export type PolicyGaugeSegment = Readonly<{ outcome: PolicyGaugeSegmentOutcome; share: number }>

/**
 * The dial's shares, decided in one place.
 *
 * With a distribution the venue priced five buckets, and the dial shows two claims beside the event:
 * holding, and everything else merged. Without a distribution there is nothing to merge, and the dial
 * is honestly two segments: the event and "not the event", which `residual` names.
 *
 * `other` is always `100 − event − hold` and never a fourth sum of buckets: one subtraction is what
 * keeps the arcs meeting exactly, and two sources is how a dial ends up with a sliver of gap. When the
 * event *is* holding there is no separate hold segment — the same bucket cannot be drawn twice — and
 * everything else is the rest.
 */
export function policyGaugeSegments(input: Readonly<{
  probability: number
  outcome: string
  distribution?: Readonly<Record<string, number>>
}>): readonly PolicyGaugeSegment[] {
  return shares(gaugeShares(input))
}

/**
 * The legend's items: every non-event share, a zero one included.
 *
 * The arcs drop a zero share because a zero-degree arc is nothing to draw; the legend does not,
 * because "维持 0.0%" is a fact about the board — the market prices no chance of holding — and a
 * missing line would read as "we did not look". Without a distribution there is no non-event item to
 * name, so the legend is empty rather than holding a lone "其余 100%".
 */
export function policyGaugeLegend(input: Readonly<{
  probability: number
  outcome: string
  distribution?: Readonly<Record<string, number>>
}>): readonly PolicyGaugeSegment[] {
  if (!input.distribution) return Object.freeze([])
  return Object.freeze(gaugeShares(input).filter((segment) => segment.outcome !== 'event'))
}

/** The three claims before any zero is dropped: one place, so the arcs and the legend cannot disagree. */
function gaugeShares(input: Readonly<{
  probability: number
  outcome: string
  distribution?: Readonly<Record<string, number>>
}>): readonly PolicyGaugeSegment[] {
  const event = clamp(input.probability, 0, 100)
  const distribution = input.distribution
  if (!distribution) return [{ outcome: 'event', share: event }, { outcome: 'residual', share: 100 - event }]
  const holdShare = input.outcome === 'no-change' ? 0 : clamp((distribution['no-change'] ?? 0) * 100, 0, 100)
  const hold: PolicyGaugeSegment | undefined = input.outcome === 'no-change' ? undefined : { outcome: 'hold', share: holdShare }
  const remainder = 100 - event - (hold?.share ?? 0)
  return [{ outcome: 'event', share: event }, ...(hold ? [hold] : []), { outcome: 'other', share: remainder }]
}

/** Drop the zero shares: a bucket nobody priced draws no arc. */
function shares(segments: readonly PolicyGaugeSegment[]): readonly PolicyGaugeSegment[] {
  return Object.freeze(segments.filter((segment) => segment.share > 0))
}

/**
 * The dial's arcs, one per non-zero share.
 *
 * Each share is drawn in proportion and a share of zero draws nothing at all, so the same function
 * serves a one-, two- or three-segment dial without the layout changing. The outcome travels with the
 * path: the caller paints and labels by role, not by array position.
 */
export function policyGaugeArcs(segments: readonly PolicyGaugeSegment[]): readonly Readonly<{ outcome: PolicyGaugeSegmentOutcome; path: string }>[] {
  const { cx, cy, radius } = POLICY_GAUGE
  const total = segments.reduce((sum, segment) => sum + clamp(segment.share, 0, 100), 0)
  // Guard against shares that already add to more than the dial.
  const scale = total > 100 ? 100 / total : 1
  const arcs: Readonly<{ outcome: PolicyGaugeSegmentOutcome; path: string }>[] = []
  let fromDeg = -180
  for (const segment of segments) {
    const share = clamp(segment.share, 0, 100) * scale
    if (share <= 0) continue
    const toDeg = fromDeg + (share / 100) * 180
    arcs.push(Object.freeze({ outcome: segment.outcome, path: arcPath(radius, cx, cy, fromDeg, toDeg) }))
    fromDeg = toDeg
  }
  return Object.freeze(arcs)
}

/** The dial's empty track: one full half circle, drawn under the segments. */
export function policyGaugeTrack(): string {
  const { cx, cy, radius } = POLICY_GAUGE
  return arcPath(radius, cx, cy, -180, 0)
}

/** One point of a stored price curve: the instant it belongs to and its zero-anchored return. */
export type PriceCurvePoint = Readonly<{ at: string; returnPercent: number }>

/** What one price card draws: a polyline and a fill per stored segment, in document order. */
export type PriceCurvePaths = Readonly<{ lines: readonly string[]; areas: readonly string[] }>

/**
 * The price card's curve, drawn from the stored segments.
 *
 * Two properties matter and are computed here rather than in the component:
 *
 * - **x is time, not index.** The segments are stretches of one window with the missing readings cut
 *   out; spacing them by index would give a four-hour stretch the same width as a twenty-hour one, and
 *   a gap would lose its length. The axis is the first kept instant to the last.
 * - **one vertical scale for every segment**, so a second segment is not silently rescaled to fill the
 *   column and made to look like a bigger move than the first.
 *
 * The fill exists only above the zero axis. A segment that never rises above zero gets no area at all
 * rather than a band lying along the axis, which would claim a move that did not happen.
 */
export function priceCurvePaths(segments: readonly (readonly PriceCurvePoint[])[]): PriceCurvePaths {
  const points = segments.flat()
  if (points.length < 2) return { lines: [], areas: [] }
  const first = Date.parse(points[0]!.at)
  const last = Date.parse(points.at(-1)!.at)
  const span = last - first
  const max = Math.max(...points.map((point) => Math.abs(point.returnPercent)), 0)
  if (!(span > 0) || max === 0) return { lines: [], areas: [] }
  const { width, height, zeroY } = PRICE_AREA
  const xOf = (at: string): number => round(((Date.parse(at) - first) / span) * width)
  const yOf = (value: number, floor: number): number =>
    round(clamp(zeroY - (value / max) * (height / 2 - 1), 0, floor))
  const lines: string[] = []
  const areas: string[] = []
  for (const segment of segments) {
    if (segment.length < 2) continue
    const xs = segment.map((point) => xOf(point.at))
    lines.push(segment.map((point, index) => `${xs[index]},${yOf(point.returnPercent, height)}`).join(' '))
    const above = segment.some((point) => point.returnPercent > 0)
    areas.push(above
      ? `M ${xs[0]} ${zeroY} ${segment.map((point, index) => `L ${xs[index]} ${yOf(point.returnPercent, zeroY)}`).join(' ')} L ${xs.at(-1)} ${zeroY} Z`
      : '')
  }
  return { lines: Object.freeze(lines), areas: Object.freeze(areas) }
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
