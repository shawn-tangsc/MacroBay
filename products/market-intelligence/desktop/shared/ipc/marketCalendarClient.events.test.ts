import { describe, expect, it } from 'vitest'

import { eventIndexReadOf } from './marketCalendarClient'

/**
 * 事件目录读口的边界：**空数组只表示「没有匹配」，不表示读不到**。
 *
 * 一条残行混进清单就是一条编出来的事件；把「读不到」说成「没有匹配」同样不行。
 */
const row = {
  key: '["212058",70663]', countryCode: 'US', metricKey: '["212058",70663]',
  sourceLabel: 'transmutation in seasonally adjusted unemployment', titleIsSourceLabel: true,
  importance: 'medium', eventType: 'economic-indicator'
}

describe('eventIndexReadOf', () => {
  it('accepts an available page, with or without a cursor', () => {
    const page = eventIndexReadOf({ state: 'available', rows: [row], total: 621 })
    expect(page.state).toBe('available')
    expect(page.state === 'available' && page.total).toBe(621)
    expect(page.state === 'available' && page.rows).toHaveLength(1)
    const withCursor = eventIndexReadOf({ state: 'available', rows: [], total: 0, nextCursor: 'k2' })
    expect(withCursor.state === 'available' && withCursor.nextCursor).toBe('k2')
    // 空数组是「没有匹配」，仍然是 available——不许退化成读不到。
    expect(withCursor.state).toBe('available')
  })

  it('keeps "could not read" a separate answer', () => {
    expect(eventIndexReadOf({ state: 'unavailable', reasonCode: 'query-unavailable' }))
      .toEqual({ state: 'unavailable', reasonCode: 'query-unavailable' })
    expect(eventIndexReadOf(undefined).state).toBe('unavailable')
    expect(eventIndexReadOf({ state: 'available' }).state).toBe('unavailable')
  })

  it('refuses a half-formed row instead of listing a made-up event', () => {
    for (const broken of [{ ...row, key: '' }, { ...row, countryCode: '' }, { ...row, titleIsSourceLabel: 'yes' }, { ...row, importance: 'urgent' }]) {
      expect(eventIndexReadOf({ state: 'available', rows: [broken], total: 1 }).state).toBe('unavailable')
    }
  })
})
