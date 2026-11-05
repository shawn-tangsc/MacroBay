import { describe, expect, it } from 'vitest'

import { briefingMacroEmptyReason } from './dailyBriefingMacroEmptyReason'

const dataAsOf = '2026-11-05T07:00:00.000Z'
const base = { state: 'available' as const, dataAsOf }

describe('the macro column says which kind of "we cannot see it" this is', () => {
  it('never collected', () => {
    expect(briefingMacroEmptyReason(base)).toBe('calendar-not-collected')
  })

  it('collect failed after the last success', () => {
    expect(briefingMacroEmptyReason({ ...base, lastCollectedAt: '2026-11-05T06:30:00.000Z', lastAttemptAt: '2026-11-05T06:45:00.000Z', lastAttemptFailed: true }))
      .toBe('calendar-collect-failed')
  })

  it('a later success outranks an earlier failure', () => {
    // "失败后又有成功"不许判成失败：比较两次时刻的先后，不是只看最近一次的状态。
    expect(briefingMacroEmptyReason({ ...base, lastCollectedAt: '2026-11-05T06:50:00.000Z', lastAttemptAt: '2026-11-05T06:30:00.000Z', lastAttemptFailed: true }))
      .toBe('past-24h-no-high-impact-release')
  })

  it('stale when the last success is more than two hours before the data cutoff', () => {
    // 11-05 那期：截止 07:00，最后一次成功在前天 21:27 —— 过期，必须写"读不到"，不许写"没有"。
    expect(briefingMacroEmptyReason({ ...base, lastCollectedAt: '2026-11-03T13:27:00.000Z' })).toBe('calendar-stale')
  })

  it('fresh data with nothing in the window is the only "there was nothing"', () => {
    expect(briefingMacroEmptyReason({ ...base, lastCollectedAt: '2026-11-05T06:30:00.000Z' })).toBe('past-24h-no-high-impact-release')
  })

  it('a failed read is "cannot see", never "nothing there"', () => {
    expect(briefingMacroEmptyReason({ ...base, state: 'unavailable' })).toBe('calendar-unavailable')
    expect(briefingMacroEmptyReason({ ...base, state: 'source-disabled' })).toBe('calendar-source-disabled')
  })
})
