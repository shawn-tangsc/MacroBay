import { expect, it } from 'vitest'

import { calendarMonthsBetween } from './useCrossAssetEventLines'

/**
 * 窗口跨过的自然月（评审 be5e5e55 的 ⑥）。
 *
 * 30d 准入之前，图上窗口最多 8 天、最多跨两个月，"取首尾两个月"够用；30d 之后一个窗口可以跨三个月，
 * 中间那个月的事件会整段消失。这条断言就是那个缺陷的回归。
 */
it('enumerates every month a window spans, not just its first and last', () => {
  expect(calendarMonthsBetween('2026-10-10T00:00:00.000Z', '2026-10-16T00:00:00.000Z')).toEqual(['2026-10'])
  expect(calendarMonthsBetween('2026-10-10T00:00:00.000Z', '2026-11-02T00:00:00.000Z')).toEqual(['2026-10', '2026-11'])
  // 30 天窗口跨三个自然月：中间那个月正是旧写法会漏掉的
  expect(calendarMonthsBetween('2026-01-30T12:00:00.000Z', '2026-03-01T12:00:00.000Z')).toEqual(['2026-01', '2026-02', '2026-03'])
  expect(calendarMonthsBetween('2026-11-05T00:00:00.000Z', '2027-01-04T00:00:00.000Z')).toEqual(['2026-11', '2026-12', '2027-01'])
})
