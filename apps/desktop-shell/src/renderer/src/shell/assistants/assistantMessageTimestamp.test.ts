import { describe, expect, it } from 'vitest'

import { formatAssistantMessageTimestamp } from './assistantMessageTimestamp'

const NOW = new Date('2026-07-19T04:00:00.000Z')

describe('formatAssistantMessageTimestamp', () => {
  it('renders the clock in the given display time zone, not the system one', () => {
    const createdAt = '2026-07-19T01:05:00.000Z'

    // 同一瞬时在三个显示时区下必须是三个不同的钟点：这正是「同屏两套时间」暴露过的地方。
    expect(formatAssistantMessageTimestamp(createdAt, 'Asia/Shanghai', NOW)).toBe('09:05')
    expect(formatAssistantMessageTimestamp(createdAt, 'UTC', NOW)).toBe('01:05')
    expect(formatAssistantMessageTimestamp(createdAt, 'America/New_York', NOW)).toBe('07-18 21:05')
  })

  it('keeps the month-day prefix for a timestamp outside the display day', () => {
    const createdAt = '2026-07-18T01:05:00.000Z'

    expect(formatAssistantMessageTimestamp(createdAt, 'Asia/Shanghai', NOW)).toBe('07-18 09:05')
  })

  it('decides "today" in the display time zone, not in the system one', () => {
    // 2026-07-18T16:30Z 在上海是 07-19 00:30（同一天），在纽约是 07-18 12:30（前一天）。
    const createdAt = '2026-07-18T16:30:00.000Z'

    expect(formatAssistantMessageTimestamp(createdAt, 'Asia/Shanghai', NOW)).toBe('00:30')
    expect(formatAssistantMessageTimestamp(createdAt, 'America/New_York', NOW)).toBe('07-18 12:30')
  })

  it('returns null for invalid persisted timestamps', () => {
    expect(formatAssistantMessageTimestamp('not-an-iso-date', 'UTC', NOW)).toBeNull()
  })
})
