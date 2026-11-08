import { describe, expect, it } from 'vitest'

import {
  CALENDAR_REMINDER_MEMBERS,
  decideCalendarReminderSurfaces,
  availableCalendarReminderSurfaces,
  type CalendarReminderMember,
  type CalendarReminderSurface
} from './calendarEventReminder'

/** 两条日历通知今天都批 `center` + `toast` + `channel`；桌面两条都不批。 */
const FULL: Readonly<Record<CalendarReminderMember, readonly string[]>> = Object.freeze({
  'market-intelligence.calendar.event-upcoming': ['center', 'toast', 'channel'],
  'market-intelligence.macro.event-landed': ['center', 'toast', 'channel']
})

function approvals(overrides: Partial<Record<CalendarReminderMember, readonly string[]>> = {}) {
  return { ...FULL, ...overrides }
}

const ON: Readonly<Partial<Record<CalendarReminderSurface, boolean>>> = { channel: true, toast: true }

describe('calendar reminder surfaces', () => {
  it('never offers a surface the approvals do not cover', () => {
    // 桌面两条都没批 → 它**不存在**，不是「存在但禁用」。
    expect(availableCalendarReminderSurfaces(approvals())).toEqual(['channel', 'toast'])
    expect(availableCalendarReminderSurfaces(approvals())).not.toContain('desktop')
  })

  it('takes the intersection: one member short of a surface drops it for the shared choice', () => {
    // 共享选择只勾一次：若某条没批「应用内提示」，那个勾对一条生效、对另一条不生效。
    expect(availableCalendarReminderSurfaces(approvals({
      'market-intelligence.macro.event-landed': ['center', 'channel']
    }))).toEqual(['channel'])
  })

  it('a master switch off silences only that surface', () => {
    const decided = decideCalendarReminderSurfaces({ approvals: approvals(), master: { toast: false }, selection: ON })
    expect(decided).toEqual({ channel: true, toast: false })
  })

  it('the group selection only narrows, never widens', () => {
    // 选择全关 → 底层两层都允许也一条不投。
    const silenced = decideCalendarReminderSurfaces({
      approvals: approvals(),
      master: {},
      selection: { channel: false, toast: false }
    })
    expect(silenced).toEqual({ channel: false, toast: false })

    // 选择没勾过（缺省）按「允许」：读者刚打开提醒、还没勾表面，不该什么都收不到。
    const untouched = decideCalendarReminderSurfaces({ approvals: approvals(), master: {}, selection: {} })
    expect(untouched).toEqual({ channel: true, toast: true })

    // 选择勾了某个未批的表面，也**不会**让它出现。
    const overreaching = decideCalendarReminderSurfaces({
      approvals: approvals(),
      master: {},
      selection: { desktop: true } as never
    })
    expect(overreaching).toEqual({ channel: true, toast: true })
    expect(Object.keys(overreaching).sort()).toEqual(['channel', 'toast'])
  })

  it('a surface nobody approved stays off even when both lower layers allow it', () => {
    const decided = decideCalendarReminderSurfaces({
      approvals: { ...FULL, [CALENDAR_REMINDER_MEMBERS[0]]: ['center'] },
      master: ON,
      selection: ON
    })
    expect(decided).toEqual({ channel: false, toast: false })
  })
})
