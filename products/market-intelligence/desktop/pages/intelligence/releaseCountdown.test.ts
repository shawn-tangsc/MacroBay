import { describe, expect, it } from 'vitest'

import { countdownForDate, countdownForInstant, releaseCountdownFor } from './releaseCountdown'

/**
 * 三条口径（用户 2026-11-14 定）：
 * - 超过 24 小时 → 整数天；24 小时内 → 倒计时；最后 1 小时 → 只到分；
 * - 只有日期 → 只给天数，**不做倒计时**（那一刻几点我们不知道）；
 * - 取整向上：不许出现「还有 0 分」——那会让人以为已经发布了。
 */
describe('releaseCountdown', () => {
  const now = '2026-11-14T09:00:00.000Z'

  it('gives whole days beyond 24 hours', () => {
    expect(countdownForInstant({ now, releaseAt: '2026-12-04T13:30:00.000Z' })).toEqual({ kind: 'days', days: 20 })
  })

  it('counts down to the minute inside 24 hours', () => {
    // 12 小时 40 分整。
    expect(countdownForInstant({ now, releaseAt: '2026-11-14T21:40:00.000Z' }))
      .toEqual({ kind: 'countdown', hours: 12, minutes: 40 })
  })

  it('drops the hours during the last hour', () => {
    expect(countdownForInstant({ now, releaseAt: '2026-11-14T09:42:00.000Z' }))
      .toEqual({ kind: 'imminent', minutes: 42 })
  })

  it('never says 0 minutes while the release is still ahead', () => {
    expect(countdownForInstant({ now, releaseAt: '2026-11-14T09:00:20.000Z' }))
      .toEqual({ kind: 'imminent', minutes: 1 })
  })

  it('rounds a partial hour up, not down', () => {
    // 59 分 40 秒 —— 说「59 分」会早一分钟兑现。
    expect(countdownForInstant({ now, releaseAt: '2026-11-14T09:59:40.000Z' }))
      .toEqual({ kind: 'imminent', minutes: 60 })
  })

  it('reports a release that has already passed instead of a negative count', () => {
    expect(countdownForInstant({ now, releaseAt: '2026-11-14T08:00:00.000Z' })).toEqual({ kind: 'past' })
  })

  it('counts calendar days for a date-only release', () => {
    expect(countdownForDate({ nowDate: '2026-11-14', releaseDate: '2026-11-17' })).toEqual({ kind: 'days', days: 3 })
    expect(countdownForDate({ nowDate: '2026-11-14', releaseDate: '2026-11-14' })).toEqual({ kind: 'days', days: 0 })
    expect(countdownForDate({ nowDate: '2026-11-14', releaseDate: '2026-11-13' })).toEqual({ kind: 'past' })
  })

  /** 精度缺省按「只有日期」：旧投影不产出 `timePrecision`，宁可不倒计时而不要编时刻。 */
  it('refuses to count down without a known time precision', () => {
    const input = {
      now, nowDate: '2026-11-14', releaseAt: '2026-11-14T03:00:00.000Z', releaseDate: '2026-11-14'
    }
    expect(releaseCountdownFor(input)).toEqual({ kind: 'days', days: 0 })
    expect(releaseCountdownFor({ ...input, timePrecision: 'date' })).toEqual({ kind: 'days', days: 0 })
    expect(releaseCountdownFor({ ...input, timePrecision: 'minute' })).toEqual({ kind: 'past' })
  })
})
