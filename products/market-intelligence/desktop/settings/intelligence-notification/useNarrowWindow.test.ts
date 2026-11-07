import { describe, expect, it } from 'vitest'

import { DETAIL_COLUMN_MIN_WIDTH, LIST_COLUMN_WIDTH, resolveNotificationLayout } from './useNarrowWindow'

/**
 * 断点按**页面自身宽度**算（导航不在里面）：48 + 220 + 20 + 560 = 848，留 12 → **860**。
 * 若哪天改回按窗口宽度判断，那个数必须是 1080——两套坐标系不许混用。
 */
describe('notification layout widths', () => {
  it('switches to the dropdown one pixel below the page minimum', () => {
    expect(resolveNotificationLayout(859).mode).toBe('dropdown')
  })

  it('keeps three columns exactly at 860, with the detail still at its minimum', () => {
    const layout = resolveNotificationLayout(860)
    expect(layout.mode).toBe('columns')
    expect(layout.listWidth).toBe(LIST_COLUMN_WIDTH)
    expect(layout.detailWidth).toBe(860 - LIST_COLUMN_WIDTH - 20)
    expect(layout.detailWidth).toBeGreaterThanOrEqual(DETAIL_COLUMN_MIN_WIDTH)
  })

  it('stays three columns at 1000 (a window-width breakpoint would have collapsed here)', () => {
    expect(resolveNotificationLayout(1000).mode).toBe('columns')
  })

  it('never lets the list column fall below its minimum while columns are shown', () => {
    for (const width of [860, 1000, 1600]) {
      const layout = resolveNotificationLayout(width)
      expect(layout.listWidth).toBeGreaterThanOrEqual(220)
      expect(layout.detailWidth).toBeGreaterThanOrEqual(DETAIL_COLUMN_MIN_WIDTH)
    }
  })
})
