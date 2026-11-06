import { describe, expect, it } from 'vitest'

import { OI_SPARK, POLICY_GAUGE, PRICE_AREA, oiSparkPoints, policyGaugeArcs, policyGaugeLegend, policyGaugeSegments, policyGaugeTrack, priceCurvePaths } from './briefingDataGeometry'

/**
 * The geometry exists to be pinned by numbers, not looked at.
 *
 * "Vertex count equals plotted points", "two renders produce the same points" and "the first point is
 * zero" cannot be judged from a screenshot, and they are exactly what breaks silently when the
 * arithmetic moves into pixels. These cases run in milliseconds and need no DOM.
 */
describe('the policy dial', () => {
  it('draws one segment per non-zero share, not a fixed three', () => {
    expect(policyGaugeArcs([{ outcome: 'event', share: 77.5 }, { outcome: 'residual', share: 22.5 }])).toHaveLength(2)
    expect(policyGaugeArcs([{ outcome: 'event', share: 100 }])).toHaveLength(1)
    // A zero share draws nothing: the same dial serves two and three segments.
    expect(policyGaugeArcs([{ outcome: 'event', share: 0 }, { outcome: 'residual', share: 100 }])).toHaveLength(1)
  })

  it('sweeps a share in proportion to its size, and the shares add up to the half dial', () => {
    const [only] = policyGaugeArcs([{ outcome: 'event', share: 50 }])
    // A 50% share is a quarter of the half dial: 90 degrees from the left end to the top.
    expect(Math.abs(angleOf(only!.path, 0))).toBeCloseTo(180, 1)
    expect(angleOf(only!.path, 1)).toBeCloseTo(-90, 1)
  })

  it('keeps the track a full half circle', () => {
    expect(Math.abs(angleOf(policyGaugeTrack(), 0))).toBeCloseTo(180, 1)
    expect(angleOf(policyGaugeTrack(), 1)).toBeCloseTo(0, 1)
  })
})

describe('the price area', () => {
  const curve = (...values: readonly number[]): readonly { at: string; returnPercent: number }[] =>
    values.map((returnPercent, index) => ({ at: new Date(Date.parse('2026-10-29T00:30:00.000Z') + index * 1_800_000).toISOString(), returnPercent }))

  it('fills only above the zero axis, and draws nothing when every point is negative', () => {
    const negative = priceCurvePaths([curve(-1, -2, -3)])
    expect(negative.lines).toHaveLength(1)
    expect(negative.areas).toEqual([''])
    expect(priceCurvePaths([curve(1, 2, 3)]).areas[0]).not.toBe('')
    // A single point is not a shape.
    expect(priceCurvePaths([curve(1)])).toEqual({ lines: [], areas: [] })
  })

  it('is deterministic: the same input produces the same points twice', () => {
    expect(priceCurvePaths([curve(1, 3, 2, 5)])).toEqual(priceCurvePaths([curve(1, 3, 2, 5)]))
  })

  it('draws one line per segment and spaces the x axis by time, both ends on the width', () => {
    // Two segments separated by an hour: the second must start where the clock says, not where the
    // first one ended, or the gap would lose its length.
    const at = (minutes: number) => new Date(Date.parse('2026-10-29T00:00:00.000Z') + minutes * 60_000).toISOString()
    const first = [{ at: at(0), returnPercent: 0 }, { at: at(30), returnPercent: 1 }]
    const second = [{ at: at(90), returnPercent: 2 }, { at: at(150), returnPercent: 3 }]
    const paths = priceCurvePaths([first, second])
    expect(paths.lines).toHaveLength(2)
    const xOf = (line: string, index: number) => Number(line.split(' ')[index]!.split(',')[0])
    expect(xOf(paths.lines[0]!, 0)).toBe(0)
    // 90 of 150 minutes in: the gap keeps its width instead of collapsing.
    expect(xOf(paths.lines[1]!, 0)).toBeCloseTo((90 / 150) * PRICE_AREA.width, 1)
    expect(xOf(paths.lines[1]!, 1)).toBe(PRICE_AREA.width)
  })

  it('draws a flat sparkline down the middle rather than dividing by zero', () => {
    const points = oiSparkPoints([5, 5, 5]).split(' ')
    for (const point of points) expect(Number(point.split(',')[1])).toBe(OI_SPARK.height / 2)
  })
})

describe("the dial's shares", () => {
  const distribution = { 'no-change': 0.205, 'hike-25': 0.775, 'hike-50-plus': 0.015, 'cut-25': 0.004, 'cut-50-plus': 0.001 }

  it('is two segments without a distribution: the event and the rest of the dial', () => {
    expect(policyGaugeSegments({ probability: 77.5, outcome: 'hike-25' })).toEqual([
      { outcome: 'event', share: 77.5 },
      { outcome: 'residual', share: 22.5 }
    ])
  })

  it('merges the board into event, holding and the rest once the distribution is there', () => {
    const segments = policyGaugeSegments({ probability: 77.5, outcome: 'hike-25', distribution })
    expect(segments.map((segment) => segment.outcome)).toEqual(['event', 'hold', 'other'])
    expect(segments[1]!.share).toBeCloseTo(20.5, 1)
    // The rest is one subtraction, never a second sum of the three loose buckets.
    expect(segments[2]!.share).toBeCloseTo(100 - 77.5 - 20.5, 1)
    expect(segments.every((segment) => segment.outcome !== 'residual')).toBe(true)
    // Arc lengths are the shares: the three arcs together sweep the whole half dial.
    const arcs = policyGaugeArcs(segments)
    expect(Math.abs(angleOf(arcs[0]!.path, 0))).toBeCloseTo(180, 1)
    expect(angleOf(arcs.at(-1)!.path, 1)).toBeCloseTo(0, 1)
  })

  it('sweeps every segment in proportion to its own share, not just the ends of the dial', () => {
    const arcs = policyGaugeArcs(policyGaugeSegments({ probability: 77.5, outcome: 'hike-25', distribution }))
    // Angles come back in (-180, 180] from the dial's centre; a sweep is measured going clockwise from
    // the left end, so wrap the endpoints into [0, 360) first.
    const wrap = (deg: number): number => ((deg % 360) + 360) % 360
    const sweep = (path: string): number => {
      const from = wrap(angleOf(path, 0))
      const to = wrap(angleOf(path, 1))
      return to >= from ? to - from : 360 - from + to
    }
    // Half a dial is 180 degrees, so a share of p is 1.8p degrees. Each arc is checked on its own: a
    // dial whose first and last ends agree can still be wrong in the middle.
    expect(sweep(arcs[0]!.path)).toBeCloseTo(77.5 * 1.8, 0)
    expect(sweep(arcs[1]!.path)).toBeCloseTo(20.5 * 1.8, 0)
    expect(sweep(arcs[2]!.path)).toBeCloseTo(2.0 * 1.8, 0)
  })

  it('lists the non-event shares in the legend, and nothing at all without a distribution', () => {
    expect(policyGaugeLegend({ probability: 77.5, outcome: 'hike-25' })).toEqual([])
    expect(policyGaugeLegend({ probability: 77.5, outcome: 'hike-25', distribution }).map((segment) => segment.outcome))
      .toEqual(['hold', 'other'])
    // A bucket nobody priced still prints: "维持 0.0%" is a fact, a missing line would be an omission.
    const unpriced = policyGaugeLegend({
      probability: 77.5, outcome: 'hike-25', distribution: { ...distribution, 'no-change': 0 }
    })
    expect(unpriced.map((segment) => segment.outcome)).toEqual(['hold', 'other'])
    expect(unpriced[0]!.share).toBe(0)
  })

  it('does not draw the held bucket twice when holding is the event', () => {
    const segments = policyGaugeSegments({ probability: 50, outcome: 'no-change', distribution })
    expect(segments.map((segment) => segment.outcome)).toEqual(['event', 'other'])
    expect(segments[1]!.share).toBeCloseTo(50, 1)
  })
})

/** The angle, in degrees, of the start (`index` 0) or end point of an arc path, around the dial's centre. */
function angleOf(path: string, index: 0 | 1): number {
  const numbers = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number)
  // `M x1 y1 A r r 0 large sweep x2 y2`: the end point sits after the flags.
  const x = index === 0 ? numbers[0]! : numbers[7]!
  const y = index === 0 ? numbers[1]! : numbers[8]!
  return (Math.atan2(y - POLICY_GAUGE.cy, x - POLICY_GAUGE.cx) * 180) / Math.PI
}

// The constants the component reads; asserted so a silent resize cannot slip through.
describe('the viewBox sizes are the design’s own', () => {
  it('keeps the dial, the area and the sparkline at their stated sizes', () => {
    expect(POLICY_GAUGE).toMatchObject({ width: 88, height: 54 })
    expect(PRICE_AREA).toMatchObject({ width: 100, height: 70 })
    expect(OI_SPARK).toMatchObject({ width: 60, height: 26 })
  })
})
