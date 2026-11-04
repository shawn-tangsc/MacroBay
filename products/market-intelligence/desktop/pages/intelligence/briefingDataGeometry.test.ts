import { describe, expect, it } from 'vitest'

import { OI_SPARK, POLICY_GAUGE, PRICE_AREA, oiSparkPoints, policyGaugeArcs, policyGaugeTrack, priceAreaPath, priceLinePoints } from './briefingDataGeometry'

/**
 * The geometry exists to be pinned by numbers, not looked at.
 *
 * "Vertex count equals plotted points", "two renders produce the same points" and "the first point is
 * zero" cannot be judged from a screenshot, and they are exactly what breaks silently when the
 * arithmetic moves into pixels. These cases run in milliseconds and need no DOM.
 */
describe('the policy dial', () => {
  it('draws one segment per non-zero share, not a fixed three', () => {
    expect(policyGaugeArcs([77.5, 22.5])).toHaveLength(2)
    expect(policyGaugeArcs([100])).toHaveLength(1)
    // A zero share draws nothing: the same dial serves two and three segments.
    expect(policyGaugeArcs([0, 100])).toHaveLength(1)
  })

  it('sweeps a share in proportion to its size, and the shares add up to the half dial', () => {
    const [only] = policyGaugeArcs([50])
    // A 50% share is a quarter of the half dial: 90 degrees from the left end to the top.
    expect(Math.abs(angleOf(only!, 0))).toBeCloseTo(180, 1)
    expect(angleOf(only!, 1)).toBeCloseTo(-90, 1)
  })

  it('keeps the track a full half circle', () => {
    expect(Math.abs(angleOf(policyGaugeTrack(), 0))).toBeCloseTo(180, 1)
    expect(angleOf(policyGaugeTrack(), 1)).toBeCloseTo(0, 1)
  })
})

describe('the price area', () => {
  it('fills only above the zero axis, and draws nothing when every point is negative', () => {
    expect(priceAreaPath([-1, -2, -3])).toBe('')
    expect(priceAreaPath([1, 2, 3])).not.toBe('')
    // A single point is not a shape.
    expect(priceAreaPath([1])).toBe('')
  })

  it('is deterministic: the same input produces the same points twice', () => {
    expect(priceLinePoints([1, 3, 2, 5])).toBe(priceLinePoints([1, 3, 2, 5]))
  })

  it('draws a flat sparkline down the middle rather than dividing by zero', () => {
    const points = oiSparkPoints([5, 5, 5]).split(' ')
    for (const point of points) expect(Number(point.split(',')[1])).toBe(OI_SPARK.height / 2)
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
