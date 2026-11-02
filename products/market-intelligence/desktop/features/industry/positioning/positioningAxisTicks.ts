/**
 * The five instants the positioning card's time axis labels.
 *
 * The two ends are the data's own instants; the three inside snap to a round mark so the axis reads
 * like a clock. The snap unit is derived from the step, never fixed at one hour: a narrow window —
 * a card opened soon after the first collection, or a test with three buckets — would otherwise
 * round every interior label onto the same hour, drawing three identical times. The label's instant
 * is also its identity, so the duplicates were real: React dropped one child and warned.
 */
export type AxisTick = Readonly<{ at: number; first: boolean; last: boolean }>

const hourMs = 3_600_000
/** Round marks an axis may snap to, in hours: a day's worth at most, so a long window still drifts. */
const roundUnits = Object.freeze([1, 2, 3, 4, 6, 12, 24])

export function axisTicks(startMs: number, span: number, count: number): readonly AxisTick[] {
  if (count < 2 || span <= 0) return []
  const steps = 4
  const stepMs = span / steps
  // A unit wider than half a step could put two neighbours on the same mark; if none fits, the
  // labels stay on the true positions, which are distinct by construction.
  const unit = roundUnits
    .map(hours => hours * hourMs)
    .filter(candidate => candidate <= stepMs / 2)
    .pop()
  const snap = (value: number) => unit === undefined ? value : Math.round(value / unit) * unit
  return Array.from({ length: steps + 1 }, (_, index) => {
    const at = index === 0 ? startMs : index === steps ? startMs + span : snap(startMs + stepMs * index)
    return { at, first: index === 0, last: index === steps }
  })
}
