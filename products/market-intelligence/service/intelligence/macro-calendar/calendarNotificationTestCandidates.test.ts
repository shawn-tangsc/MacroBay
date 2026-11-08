import { describe, expect, it } from 'vitest'

import { DEFAULT_CALENDAR_REMINDER_SETTINGS, type CalendarReminderSettings } from '../../../contracts/calendarEventReminder'
import { calendarLandedTestCandidate, calendarUpcomingTestCandidate } from './calendarNotificationTestCandidates'

const now = '2026-11-08T02:00:00.000Z'
const settings: CalendarReminderSettings = { ...DEFAULT_CALENDAR_REMINDER_SETTINGS, enabled: true, leadMinutes: 60 }
const event = (eventKey: string, scheduledAt: string, importance: 'high' | 'medium' | 'low' = 'high') =>
  ({ eventKey, title: `事件 ${eventKey}`, scheduledAt, importance })

describe('the test button’s upcoming sample', () => {
  it('uses a candidate inside the reminder lead, with the real remaining minutes', () => {
    const candidate = calendarUpcomingTestCandidate({ now, settings, source: 'available', events: [event('soon', '2026-11-08T02:30:00.000Z')] })
    expect(candidate).toEqual({ kind: 'reminder', eventKey: 'soon', title: '事件 soon',
      scheduledAt: '2026-11-08T02:30:00.000Z', importance: 'high', remainingMinutes: 30 })
  })

  it('falls back to the nearest future event and hands over its real time', () => {
    // 三小时后才发生：不在提前量内，所以不当「马上提醒」，但要给出真实时间。
    const candidate = calendarUpcomingTestCandidate({ now, settings, source: 'available', events: [event('later', '2026-11-08T05:00:00.000Z')] })
    expect(candidate).toMatchObject({ kind: 'nearest-future', eventKey: 'later', scheduledAt: '2026-11-08T05:00:00.000Z', minutesUntil: 180 })
  })

  it('keeps source-disabled, unreadable and truly-none as three different answers', () => {
    expect(calendarUpcomingTestCandidate({ now, settings, source: 'disabled', events: [] })).toEqual({ kind: 'source-disabled' })
    expect(calendarUpcomingTestCandidate({ now, settings, source: 'unreadable', events: [] })).toEqual({ kind: 'unreadable' })
    expect(calendarUpcomingTestCandidate({ now, settings, source: 'available', events: [] })).toEqual({ kind: 'none-upcoming' })
    // 已经开始的也不进「未来一条」。
    expect(calendarUpcomingTestCandidate({ now, settings, source: 'available', events: [event('past', '2026-11-08T01:00:00.000Z')] }))
      .toEqual({ kind: 'none-upcoming' })
  })

  it('matches what the reminder scan would call a candidate, including the importance filter', () => {
    const medium: CalendarReminderSettings = { ...settings, importance: ['high'] }
    const candidate = calendarUpcomingTestCandidate({ now, settings: medium, source: 'available', events: [event('medium', '2026-11-08T02:30:00.000Z', 'medium')] })
    // 重要性没勾的事件不会出现在提醒里，测试按钮也不该拿它冒充。
    expect(candidate.kind).toBe('nearest-future')
  })
})

describe('the test button’s landed sample', () => {
  const landedEvent = (eventKey: string, scheduledAt: string, actual: string | null) =>
    ({ eventKey, title: `事件 ${eventKey}`, scheduledAt, importance: 'high' as const, actual: actual === null ? null : { displayValue: actual } })

  it('takes the most recent event that actually has a value', () => {
    const candidate = calendarLandedTestCandidate({ now, source: 'available', events: [
      landedEvent('older', '2026-11-08T00:00:00.000Z', '1.2%'),
      landedEvent('newer', '2026-11-08T01:00:00.000Z', '0.3%'),
      // 时间过了但没有值：这是「还没公布」，不是最近的结果。
      landedEvent('pending', '2026-11-08T01:30:00.000Z', null),
      landedEvent('future', '2026-11-08T03:00:00.000Z', '9.9%')
    ] })
    expect(candidate).toEqual({ kind: 'landed', eventKey: 'newer', title: '事件 newer',
      scheduledAt: '2026-11-08T01:00:00.000Z', importance: 'high', actual: '0.3%' })
  })

  it('separates “nothing has landed” from “the source is off or unreadable”', () => {
    expect(calendarLandedTestCandidate({ now, source: 'available', events: [landedEvent('pending', '2026-11-08T01:00:00.000Z', null)] }))
      .toEqual({ kind: 'none-landed' })
    expect(calendarLandedTestCandidate({ now, source: 'disabled', events: [] })).toEqual({ kind: 'source-disabled' })
    expect(calendarLandedTestCandidate({ now, source: 'unreadable', events: [] })).toEqual({ kind: 'unreadable' })
  })
})
