import { describe, expect, it } from 'vitest'

import { DEFAULT_CALENDAR_REMINDER_SETTINGS, type CalendarReminderSettings } from '../../../contracts/calendarEventReminder'
import {
  calendarReminderDedupeKey,
  selectCalendarReminderCandidates,
  type CalendarReminderEvent
} from './calendarEventReminderScan'

const NOW = '2026-11-07T12:00:00.000Z'

function settings(overrides: Partial<CalendarReminderSettings> = {}): CalendarReminderSettings {
  // Derived from the contract's default so a newly required field cannot be left out silently.
  return { ...DEFAULT_CALENDAR_REMINDER_SETTINGS, enabled: true, ...overrides }
}

function event(overrides: Partial<CalendarReminderEvent> = {}): CalendarReminderEvent {
  return { eventKey: 'US.CPI.RELEASE.2026-M11', title: 'CPI', scheduledAt: '2026-11-07T12:20:00.000Z', importance: 'high', ...overrides }
}

describe('calendar reminder scan', () => {
  it('says how many minutes are left, not the configured lead', () => {
    // 补发那条最容易被写成「60 分钟后」——事件此刻只剩 20 分钟。句子里的数只能是这一个。
    const { candidates } = selectCalendarReminderCandidates({ events: [event()], settings: settings(), now: NOW })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.remainingMinutes).toBe(20)
    expect(candidates[0]?.remainingMinutes).not.toBe(settings().leadMinutes)
  })

  it('never reminds an event that has already started, even by a second', () => {
    const started = event({ scheduledAt: '2026-11-07T11:59:59.000Z' })
    const selection = selectCalendarReminderCandidates({ events: [started], settings: settings(), now: NOW })
    expect(selection.candidates).toEqual([])
    expect(selection.skipped).toEqual({ 'already-started': 1 })
  })

  it('keeps the key free of the lead, so changing the lead cannot re-send an already-sent event', () => {
    const sixty = selectCalendarReminderCandidates({ events: [event()], settings: settings({ leadMinutes: 60 }), now: NOW })
    const thirty = selectCalendarReminderCandidates({ events: [event()], settings: settings({ leadMinutes: 30 }), now: NOW })
    expect(sixty.candidates[0]?.dedupeKey).toBe(thirty.candidates[0]?.dedupeKey)
    expect(sixty.candidates[0]?.dedupeKey).toBe(calendarReminderDedupeKey({ eventKey: event().eventKey, scheduledAt: event().scheduledAt! }))
  })

  it('reminds only the importance levels the reader ticked', () => {
    const events = [
      event({ eventKey: 'a', importance: 'high' }),
      event({ eventKey: 'b', importance: 'medium' }),
      event({ eventKey: 'c', importance: 'low' })
    ]
    const selection = selectCalendarReminderCandidates({ events, settings: settings({ importance: ['high'] }), now: NOW })
    expect(selection.candidates.map((candidate) => candidate.eventKey)).toEqual(['a'])
    expect(selection.skipped).toEqual({ 'importance-not-selected': 2 })
  })

  it('skips events with no instant instead of guessing one from the date', () => {
    const selection = selectCalendarReminderCandidates({
      events: [event({ scheduledAt: undefined }), event({ eventKey: 'bad', scheduledAt: 'not-an-instant' })],
      settings: settings(),
      now: NOW
    })
    expect(selection.candidates).toEqual([])
    expect(selection.skipped).toEqual({ 'missing-schedule': 2 })
  })

  it('stays silent while the reader has the reminder switched off', () => {
    const selection = selectCalendarReminderCandidates({ events: [event()], settings: settings({ enabled: false }), now: NOW })
    expect(selection.candidates).toEqual([])
    expect(selection.skipped).toEqual({ 'reminder-disabled': 1 })
  })

  it('lets every in-window event through: one notice per event, never merged', () => {
    const events = [event({ eventKey: 'a' }), event({ eventKey: 'b' }), event({ eventKey: 'c' })]
    const selection = selectCalendarReminderCandidates({ events, settings: settings(), now: NOW })
    expect(selection.candidates).toHaveLength(3)
    expect(selection.skipped).toEqual({})
  })
})
