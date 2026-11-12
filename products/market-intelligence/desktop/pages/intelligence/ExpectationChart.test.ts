import { describe, expect, it } from 'vitest'

import { binExpectationPoints, formatTick, EXPECTATION_BIN_PX } from './ExpectationChart'

const values = { 'no-change': 0.2, 'hike-25': 0.7, 'hike-50-plus': 0.05, 'cut-25': 0.03, 'cut-50-plus': 0.02 }
const point = (minute: number, bp: number) => ({ at: new Date(Date.UTC(2026, 9, 30, 0, minute)).toISOString(), bp, values })

describe('expectation chart ticks', () => {
  it('keeps the minus sign on the lower half of the axis', () => {
    expect([-40, -20, 0, 20, 40].map(formatTick)).toEqual(['−40bp', '−20bp', '0bp', '+20bp', '+40bp'])
  })
})

describe('expectation binning', () => {
  it('makes one bin per 3px, so the count follows the plot width and nothing else', () => {
    expect(binExpectationPoints([point(0, 20)], 300)).toHaveLength(100)
    expect(binExpectationPoints([point(0, 20)], 30)).toHaveLength(10)
    expect(EXPECTATION_BIN_PX).toBe(3)
  })

  it('takes the last observation inside a bin, never the average', () => {
    // 10 bins over one hour: the first two points both land in bin 0.
    const bins = binExpectationPoints([point(0, 10), point(3, 40), point(60, 20)], 30)
    expect(bins[0]).toBe(40)
    expect(bins[9]).toBe(20)
  })

  it('leaves an empty bin empty instead of interpolating across it', () => {
    // Points at the two ends only: the 8 bins between them must stay null, not ramp 10 → 20.
    const bins = binExpectationPoints([point(0, 10), point(60, 20)], 30)
    expect(bins[0]).toBe(10)
    expect(bins[9]).toBe(20)
    expect(bins.slice(1, 9)).toEqual(Array.from({ length: 8 }, () => null))
  })

  it('drops an unusable instant instead of placing it at zero', () => {
    const bins = binExpectationPoints([{ at: 'not-a-time', bp: 30, values }, point(0, 10)], 30)
    expect(bins.filter((value) => value !== null)).toEqual([10])
  })
})
