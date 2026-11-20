import { describe, expect, it } from 'vitest'

import { recentFlowDates } from './capitalFlowRows'

describe('recentFlowDates', () => {
  it('walks calendar days backwards from the as-of day, so the axis ends today', () => {
    // 用户 2026-11-16：「不管这一天有没有数据，轴上都要推进到这一天」。
    expect(recentFlowDates('2026-11-16T11:00:00.000Z', 7)).toEqual([
      '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16'
    ])
  })

  it('crosses month and year boundaries without skipping a day', () => {
    expect(recentFlowDates('2026-01-02T00:00:00.000Z', 3)).toEqual(['2025-12-31', '2026-01-01', '2026-01-02'])
  })

  it('returns nothing for a non-positive count', () => {
    expect(recentFlowDates('2026-11-16T00:00:00.000Z', 0)).toEqual([])
  })
})
