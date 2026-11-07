import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_CALENDAR_REMINDER_SETTINGS } from '../../../contracts/calendarEventReminder'
import { createCalendarReminderSettingsStore } from './calendarEventReminderSettingsStore'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'calendar-reminder-settings-'))
  file = join(dir, 'calendar-event-reminder.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('calendar reminder settings store', () => {
  it('starts off, at 60 minutes, for high-importance events only', () => {
    const store = createCalendarReminderSettingsStore(file)
    expect(store.read()).toEqual(DEFAULT_CALENDAR_REMINDER_SETTINGS)
    // 默认关这一条单独钉：读不到/没配置都不许变成「悄悄打开」。
    expect(store.read().enabled).toBe(false)
  })

  it('writes only the fields it is given and keeps the rest', () => {
    const store = createCalendarReminderSettingsStore(file)
    store.write({ leadMinutes: 30 })
    store.write({ enabled: true })
    expect(store.read()).toEqual({ ...DEFAULT_CALENDAR_REMINDER_SETTINGS, leadMinutes: 30, enabled: true })
    // 落盘的是同一份：另一处读文件不会看到第二套形状。
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ leadMinutes: 30, enabled: true })
  })

  it('refuses an unsupported lead instead of rounding it to something plausible', () => {
    const store = createCalendarReminderSettingsStore(file)
    store.write({ leadMinutes: 60 })
    store.write({ leadMinutes: 45 as never })
    expect(store.read().leadMinutes).toBe(60)
  })

  it('drops unknown importance values and never stores an empty list', () => {
    const store = createCalendarReminderSettingsStore(file)
    store.write({ importance: ['low', 'high', 'low', 'urgent' as never] })
    expect(store.read().importance).toEqual(['low', 'high'])
    // 全是非法值时保持原值：空数组等于「一条都不推」，与「配置写坏了」不是一回事。
    store.write({ importance: ['urgent' as never] })
    expect(store.read().importance).toEqual(['low', 'high'])
  })

  it('falls back to the default settings when the file is missing or corrupt', () => {
    const store = createCalendarReminderSettingsStore(join(dir, 'missing.json'))
    expect(store.read()).toEqual(DEFAULT_CALENDAR_REMINDER_SETTINGS)

    writeFileSync(file, '{not json', 'utf8')
    expect(createCalendarReminderSettingsStore(file).read()).toEqual(DEFAULT_CALENDAR_REMINDER_SETTINGS)
  })
})
