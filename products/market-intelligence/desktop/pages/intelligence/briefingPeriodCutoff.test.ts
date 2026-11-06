import { describe, expect, it } from 'vitest'

import { briefingCutoffPassed } from './briefingPeriodCutoff'

// 只回答"这一天的生成时刻过去了没有"。它决定空态说什么（`02` v2.129 G6）：
// 没到点只能说「计划 {time} 生成」，过了点才可以说「这一期没有生成」。
describe('deciding whether a day’s generation time has passed', () => {
  const at = (now: string) => briefingCutoffPassed({ date: '2026-11-05', time: '07:00', timeZone: 'Asia/Shanghai', now: new Date(now) })

  it('counts the cutoff as passed once the reader’s clock reaches it', () => {
    // 07:00 于 Asia/Shanghai = 前一日 23:00Z。
    expect(at('2026-11-04T22:59:59.000Z')).toBe(false)
    expect(at('2026-11-04T23:00:00.000Z')).toBe(true)
    expect(at('2026-11-05T04:00:00.000Z')).toBe(true)
  })

  it('reads the cutoff in the reader’s zone, not in UTC', () => {
    // 同一时刻：UTC 看还在 07:00 之前，Asia/Shanghai 已经过了。
    expect(briefingCutoffPassed({ date: '2026-11-05', time: '07:00', timeZone: 'UTC', now: new Date('2026-11-05T04:00:00.000Z') })).toBe(false)
    expect(briefingCutoffPassed({ date: '2026-11-05', time: '07:00', timeZone: 'Asia/Shanghai', now: new Date('2026-11-05T04:00:00.000Z') })).toBe(true)
  })

  it('refuses to answer when either the day or the time cannot be read', () => {
    // 说不出来就不说：既不许断言"还没到"，也不许断言"已经过了"。
    expect(briefingCutoffPassed({ date: 'nope', time: '07:00', timeZone: 'UTC', now: new Date() })).toBeUndefined()
    expect(briefingCutoffPassed({ date: '2026-11-05', time: 'nope', timeZone: 'UTC', now: new Date() })).toBeUndefined()
  })
})
