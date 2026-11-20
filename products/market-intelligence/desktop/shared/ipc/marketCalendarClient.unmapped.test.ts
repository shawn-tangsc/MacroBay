import { describe, expect, it } from 'vitest'

import { unmappedMonthViewOf } from './marketCalendarClient'

/**
 * IPC 回来的东西一律当 `unknown`：形状不合就判「读不到」。
 *
 * 这条边界比它看起来重要——**一条残行混进列表就是一条编出来的日程**；而把「读不到」说成
 * 「今天没有未映射事件」同样不行（用户与 Chief 反复强调的那条）。
 */
const valid = {
  key: '0xrouter:abc', providerId: '0xrouter', sourceKey: 'abc', reason: 'bad-identity',
  scheduledDate: '2026-11-05', scheduledAt: '2026-11-05T06:00:00.000Z', timePrecision: 'minute',
  title: '某条观测', countryCode: 'USA', eventType: 'unknown', detectedAt: '2026-11-05T00:00:00.000Z'
}

describe('unmappedMonthViewOf', () => {
  it('accepts the read\'s own answer', () => {
    const view = unmappedMonthViewOf({ state: 'available', items: [valid], undated: 3, superseded: 7 })
    expect(view.state).toBe('available')
    expect(view.state === 'available' && view.items).toHaveLength(1)
    expect(view.state === 'available' && view.undated).toBe(3)
    expect(view.state === 'available' && view.superseded).toBe(7)
  })

  it('keeps "could not read" a separate answer', () => {
    expect(unmappedMonthViewOf({ state: 'unavailable', reasonCode: 'query-unavailable' })).toEqual({ state: 'unavailable' })
    expect(unmappedMonthViewOf(undefined)).toEqual({ state: 'unavailable' })
    expect(unmappedMonthViewOf(null)).toEqual({ state: 'unavailable' })
    // 空数组绝不能冒充「读到了、是空的」以外的任何东西——这里「没有 items 字段」= 读不到。
    expect(unmappedMonthViewOf({ state: 'available' })).toEqual({ state: 'unavailable' })
  })

  it('refuses a half-formed row instead of drawing a made-up schedule', () => {
    const broken = [
      { ...valid, key: '' },
      { ...valid, scheduledDate: '2026/11/05' },
      { ...valid, timePrecision: 'minute', scheduledAt: undefined },
      { ...valid, timePrecision: 'hour' },
      { ...valid, title: '' },
      { ...valid, countryCode: 42 }
    ]
    for (const row of broken) {
      expect(unmappedMonthViewOf({ state: 'available', items: [row] }), JSON.stringify(row).slice(0, 60))
        .toEqual({ state: 'unavailable' })
    }
  })

  it('accepts a date-only row with no time at all', () => {
    const view = unmappedMonthViewOf({ state: 'available', items: [{ ...valid, timePrecision: 'date', scheduledAt: undefined }] })
    expect(view.state).toBe('available')
  })
})
