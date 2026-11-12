import { describe, expect, it } from 'vitest'

import { nextMeasuredSize } from './macroIndicatorDrawerMeasure'

describe('measured size write-back', () => {
  it('never invents a floor: a 340px box stays 340', () => {
    expect(nextMeasuredSize(560, 340)).toBe(340)
    expect(nextMeasuredSize(340, 340)).toBe(340)
  })

  it('returns the current value when nothing was measured, so the first frame cannot collapse it', () => {
    expect(nextMeasuredSize(340, 0)).toBe(340)
    expect(nextMeasuredSize(340, -5)).toBe(340)
    expect(nextMeasuredSize(340, Number.NaN)).toBe(340)
  })

  it('is never above what was measured — a write-back larger than the box is the self-exciting case', () => {
    for (const measured of [1, 200, 340, 560, 1280]) {
      expect(nextMeasuredSize(380, measured)).toBeLessThanOrEqual(measured)
    }
  })
})
