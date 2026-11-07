import { describe, expect, it } from 'vitest'

import { DETAIL_COLUMN_MIN_WIDTH, LIST_COLUMN_WIDTH, resolveNotificationLayout } from './useNarrowWindow'

/**
 * 三列版式的数字来自界面设计 v2.40 §9f，判据是「不许挤压」而不是「看着还行」：
 * 236（导航）+ 220（列表最小）+ 48（内边距）+ 560（详情可用宽）= 1064 → 断点 1080。
 */
describe('notification layout widths', () => {
  it('keeps three columns at 1100 (a conservative breakpoint would collapse here)', () => {
    const layout = resolveNotificationLayout(1100)
    expect(layout.mode).toBe('columns')
    expect(layout.listWidth).toBe(LIST_COLUMN_WIDTH)
    expect(layout.detailWidth).toBe(1100 - LIST_COLUMN_WIDTH - 20)
  })

  it('switches to the dropdown at 1000', () => {
    expect(resolveNotificationLayout(1000).mode).toBe('dropdown')
  })

  it('treats 1080 itself as three columns', () => {
    const layout = resolveNotificationLayout(1080)
    expect(layout.mode).toBe('columns')
    expect(layout.detailWidth).toBeGreaterThanOrEqual(DETAIL_COLUMN_MIN_WIDTH)
  })

  it('never lets the list column fall below its minimum while columns are shown', () => {
    for (const width of [1080, 1200, 1600]) {
      const layout = resolveNotificationLayout(width)
      expect(layout.listWidth).toBeGreaterThanOrEqual(220)
      expect(layout.detailWidth).toBeGreaterThanOrEqual(DETAIL_COLUMN_MIN_WIDTH)
    }
  })
})
