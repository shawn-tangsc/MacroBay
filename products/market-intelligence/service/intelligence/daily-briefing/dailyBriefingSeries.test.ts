import { describe, expect, it } from 'vitest'

import {
  briefingAmplitude,
  briefingOpenInterestSeries,
  briefingPriceCurve,
  briefingSeriesPolicy,
  sampleBucketEnds,
  sampleSpan
} from './dailyBriefingSeries'

/**
 * The two stored curves, pinned by numbers.
 *
 * Everything these cases assert is invisible in a screenshot: that the sampling is the same on both
 * renders, that the last kept point is the one the card prints, that a gap in the readings stays a gap,
 * and that the stored curve starts at zero because it was rebased rather than because the source
 * happened to. The geometry that draws them is a separate, equally numeric file.
 */

const asOf = '2026-10-30T00:30:00.000Z'
const windowStart = '2026-10-29T00:30:00.000Z'
const fiveMinutes = 300_000

/** The source curve's own grid: one instant every five minutes, `null` where no bar was measured. */
const grid = (count: number, value: (index: number) => number | null, start = windowStart): readonly Readonly<{ at: string; returnPercent: number | null }>[] =>
  Array.from({ length: count }, (_, index) => ({
    at: new Date(Date.parse(start) + index * fiveMinutes).toISOString(),
    returnPercent: value(index)
  }))

const curveOf = (points: readonly Readonly<{ at: string; returnPercent: number | null }>[] | undefined, windowHours = 24) =>
  briefingPriceCurve({ points, windowStart, windowEnd: asOf, windowHours })

describe('the stored price curve', () => {
  it('keeps at most 48 points, both ends included, and draws the same points twice', () => {
    const source = grid(289, (index) => index / 10)
    const first = curveOf(source)
    const second = curveOf(source)

    expect(first.curve).toHaveLength(1)
    const points = first.curve![0]!
    expect(points.length).toBeLessThanOrEqual(briefingSeriesPolicy.priceMaximumPoints)
    // Both ends survive: the start is the anchor the reader compares against, the end is "now".
    expect(points[0]?.at).toBe(windowStart)
    expect(points.at(-1)?.at).toBe(source.at(-1)?.at)
    // One build, one shape: a second render cannot thin a different amount.
    expect(second).toEqual(first)
  })

  it('starts at zero because it was rebased, not because the source said so', () => {
    // A shorter window cut out of the same 24-hour curve: every point is still a return against the
    // 24-hour anchor, so without rebasing the drawing would start at whatever the morning did.
    const shorterStart = new Date(Date.parse(windowStart) + fiveMinutes).toISOString()
    const source = grid(4, (index) => [5, 19.4, 19.5, 18.9][index] ?? null)
    const curve = briefingPriceCurve({ points: source, windowStart: shorterStart, windowEnd: asOf, windowHours: 12 })

    const points = curve.curve![0]!
    // The point before the window start is not part of it, and the first kept point is the anchor.
    expect(points.map((point) => point.at)).toHaveLength(3)
    expect(points[0]?.at).toBe(shorterStart)
    expect(points[0]?.returnPercent).toBeCloseTo(0, 2)
    // The stored numbers are ratios to that anchor, not the source's own 24-hour returns.
    expect(points[1]?.returnPercent).toBeCloseTo(((1.195 / 1.194) - 1) * 100, 2)
    expect(points[2]?.returnPercent).toBeCloseTo(((1.189 / 1.194) - 1) * 100, 2)
  })

  it('splits at a missing reading instead of drawing through it', () => {
    const source = grid(289, (index) => (index >= 140 && index < 150 ? null : index / 10))
    const curve = curveOf(source)

    expect(curve.curve).toHaveLength(2)
    // No point from the gap survives, so nothing was filled in to keep the line continuous.
    const gap = new Set(source.slice(140, 150).map((point) => point.at))
    for (const segment of curve.curve!) {
      expect(segment.length).toBeGreaterThanOrEqual(2)
      expect(segment.some((point) => gap.has(point.at))).toBe(false)
    }
    expect(curve.curveReason).toBeUndefined()
  })

  it('separates the four reasons it has no curve', () => {
    // The read carried no curve at all.
    expect(curveOf(undefined)).toEqual({ curveReason: 'no-snapshot' })
    // The curve is there but no point in the window has a value, so nothing can be zero.
    expect(curveOf(grid(12, () => null))).toEqual({ curveReason: 'no-anchor' })
    // One drawable point is not a line.
    expect(curveOf(grid(1, () => 0))).toEqual({ curveReason: 'too-few-points' })
    // A 24-hour curve cannot honestly answer a longer window.
    expect(curveOf(grid(289, () => 0), 48)).toEqual({ curveReason: 'window-too-long' })
  })
})

describe('the stored open interest series', () => {
  const points = (count: number) => Array.from({ length: count }, (_, index) => ({
    observedAt: new Date(Date.parse(windowStart) + index * 900_000).toISOString(),
    notionalUsd: 1_000_000_000 + index
  }))

  it('keeps at most 24 points, one per equally spaced bucket, ending on the newest amount', () => {
    const source = points(100)
    const sampled = sampleBucketEnds(source, briefingSeriesPolicy.openInterestMaximumPoints)
    const series = briefingOpenInterestSeries(source)!

    expect(sampled).toHaveLength(24)
    expect(series).toHaveLength(24)
    // The card's number is the newest amount; the sampled line has to end on exactly that.
    expect(series.at(-1)).toEqual({ at: source.at(-1)!.observedAt, value: source.at(-1)!.notionalUsd })
    // Every kept point is a bucket's last, so the values rise and none of them is the first of a bucket.
    expect(series.map((point) => point.value)).toEqual([...series.map((point) => point.value)].sort((left, right) => left - right))
    expect(series[0]?.value).toBe(source[3]!.notionalUsd)
  })

  it('keeps every point when the read already fits, and states nothing below two', () => {
    expect(briefingOpenInterestSeries(points(5))).toHaveLength(5)
    expect(briefingOpenInterestSeries(points(1))).toBeUndefined()
    expect(briefingOpenInterestSeries([])).toBeUndefined()
  })

  it('thins by the same rule every time it is called', () => {
    const source = points(100)
    expect(briefingOpenInterestSeries(source)).toEqual(briefingOpenInterestSeries(source))
  })
})

describe('the sampling rules themselves', () => {
  it('keeps both ends of a span and nothing twice', () => {
    const values = Array.from({ length: 100 }, (_, index) => index)
    const sampled = sampleSpan(values, 48)
    expect(sampled[0]).toBe(0)
    expect(sampled.at(-1)).toBe(99)
    expect(new Set(sampled).size).toBe(sampled.length)
    expect(sampled.length).toBeLessThanOrEqual(48)
  })

  it('matches the source point-for-point when it already fits', () => {
    expect(sampleSpan([1, 2, 3], 48)).toEqual([1, 2, 3])
    expect(sampleBucketEnds([1, 2, 3], 24)).toEqual([1, 2, 3])
  })
})

describe('the window amplitude', () => {
  const covered = { count: 289, expectedCount: 289, complete: true }

  it('is the window travel divided by the close the curve is anchored on', () => {
    // (high − low) / anchor × 100, computed from the same close the curve divides by — never a bar's open.
    expect(briefingAmplitude({ extremes: { high: 72_400, low: 69_800, anchor: 70_000 }, coverage: covered }))
      .toEqual({ amplitude: { percent: 3.71, high: 72_400, low: 69_800, anchor: 70_000 } })
  })

  it('states a reason instead of a number when the window is not fully covered', () => {
    const partial = briefingAmplitude({
      extremes: { high: 72_400, low: 69_800, anchor: 70_000 },
      coverage: { count: 231, expectedCount: 289, complete: false }
    })
    // A hole can hide the real high: the counts travel with the reason so the audit names the window.
    expect(partial.amplitude).toBeUndefined()
    expect(partial.amplitudeReason).toBe('partial-bars')
    expect(partial.amplitudeCoverage).toEqual({ count: 231, expectedCount: 289 })
  })

  it('states no-anchor when there is no window-start close to divide by', () => {
    expect(briefingAmplitude({ extremes: null, coverage: covered })).toEqual({ amplitudeReason: 'no-anchor' })
    expect(briefingAmplitude({ extremes: { high: 10, low: 9, anchor: 0 }, coverage: covered })).toEqual({ amplitudeReason: 'no-anchor' })
  })

  it('says nothing at all when there is no snapshot to judge', () => {
    // An absence is not a refusal: a row nobody read carries no field and no reason.
    expect(briefingAmplitude({})).toEqual({})
  })
})
