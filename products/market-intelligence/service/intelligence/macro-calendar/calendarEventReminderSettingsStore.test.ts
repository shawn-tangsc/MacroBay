import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  it('treats "which countries" as US-only when the old file has no such key, and does not rewrite it', () => {
    // 老文件就是这四项：缺键 = 可读 + 默认「只美国」，不是读失败，也不迁移。
    const legacy = { enabled: true, leadMinutes: 30, importance: ['high'], landedFilter: 'surprise-only' }
    writeFileSync(file, JSON.stringify(legacy), 'utf8')
    const store = createCalendarReminderSettingsStore(file)

    expect(store.read().landedCountries).toEqual({ scope: 'us', codes: [] })
    expect(store.readWithStatus()).toEqual({
      state: 'readable',
      settings: { ...DEFAULT_CALENDAR_REMINDER_SETTINGS, enabled: true, leadMinutes: 30 }
    })
    // 不回写：文件仍是原来那四项。
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(legacy)
  })

  it('separates "not read" from "no value stored": a corrupt file is unreadable, a missing one is readable', () => {
    const missing = createCalendarReminderSettingsStore(join(dir, 'missing.json'))
    expect(missing.readWithStatus()).toEqual({ state: 'readable', settings: DEFAULT_CALENDAR_REMINDER_SETTINGS })

    writeFileSync(file, '{not json', 'utf8')
    expect(createCalendarReminderSettingsStore(file).readWithStatus()).toEqual({ state: 'unreadable', reason: 'corrupt' })
    // 读不到**不许**回默认值（默认是关）：那等于替读者把提醒关掉。
    expect(() => createCalendarReminderSettingsStore(file).read()).toThrow('calendar-reminder-settings-unreadable')
  })

  it('「读坏了」不是「读者关掉了」：坏文件读一次是「读不到」，再保存一次原文件一个字节没变', () => {
    // 存储审计 2026-11-09 的原始缺陷：read() 回默认（默认＝关），writeWithStatus 又以默认打底整份写回，
    // 于是「读坏了」被写成「读者关掉了」，只表现成「该响没响」。
    const raw = '{"enabled":true,"leadMinutes":15,'
    writeFileSync(file, raw, 'utf8')
    const store = createCalendarReminderSettingsStore(file)

    // 最核心的一条先断言：读不到**不伪装成默认值**（旧实现这里回的是「关」）。
    expect(() => store.read()).toThrow('calendar-reminder-settings-unreadable')
    expect(store.readWithStatus()).toEqual({ state: 'unreadable', reason: 'corrupt' })
    // 判定损坏先留证据：原文件原样一份，原文件本身没被动过。
    const copies = readdirSync(dir).filter((name) => name.includes('.corrupt-'))
    expect(copies).toHaveLength(1)
    expect(readFileSync(join(dir, copies[0]!), 'utf8')).toBe(raw)
    expect(readFileSync(file, 'utf8')).toBe(raw)

    // 保存被拒：返回「没存上（读不到）」，并且原文件逐字节未变——默认「关」没有写进去。
    expect(store.writeWithStatus({ enabled: true })).toEqual({ state: 'not-saved', reason: 'unreadable' })
    expect(readFileSync(file, 'utf8')).toBe(raw)
    expect(store.writeWithStatus({ leadMinutes: 30 })).toEqual({ state: 'not-saved', reason: 'unreadable' })
    expect(readFileSync(file, 'utf8')).toBe(raw)
    // 只留一份副本：反复读同一个坏文件不再复制残片。
    expect(readdirSync(dir).filter((name) => name.includes('.corrupt-'))).toHaveLength(1)
  })

  it('留档失败就 fail-closed：按读不到处理，且绝不覆盖原文件', () => {
    const raw = '{not json'
    writeFileSync(file, raw, 'utf8')
    chmodSync(dir, 0o555)
    try {
      const store = createCalendarReminderSettingsStore(file)
      expect(store.readWithStatus()).toEqual({ state: 'unreadable', reason: 'io' })
      expect(store.writeWithStatus({ enabled: true })).toEqual({ state: 'not-saved', reason: 'unreadable' })
      expect(readFileSync(file, 'utf8')).toBe(raw)
    } finally {
      chmodSync(dir, 0o755)
    }
  })

  it('saves the country selection and reports it as saved', () => {
    const store = createCalendarReminderSettingsStore(file)
    const result = store.writeWithStatus({ landedCountries: { scope: 'custom', codes: ['CN', 'DE'] } })
    expect(result.state).toBe('saved')
    expect(store.read().landedCountries).toEqual({ scope: 'custom', codes: ['CN', 'DE'] })
    expect(JSON.parse(readFileSync(file, 'utf8')).landedCountries).toEqual({ scope: 'custom', codes: ['CN', 'DE'] })
  })

  it('reports "not saved" and keeps the old value on disk when the write fails', () => {
    const store = createCalendarReminderSettingsStore(file)
    store.write({ landedCountries: { scope: 'us', codes: [] } })
    chmodSync(file, 0o444)
    try {
      const result = store.writeWithStatus({ landedCountries: { scope: 'all', codes: [] } })
      // 读失败与存失败要能分开：这里是 not-saved + write-failed，而且磁盘上的旧值没被换掉。
      expect(result).toMatchObject({ state: 'not-saved', reason: 'write-failed' })
      if (result.state !== 'saved') expect(result).toMatchObject({ settings: { landedCountries: { scope: 'us', codes: [] } } })
      // 旧接口对同一失败仍然抛，行为不倒退。
      expect(() => store.write({ landedCountries: { scope: 'all', codes: [] } })).toThrow('calendar-reminder-settings-not-saved')
      chmodSync(file, 0o644)
      expect(store.read().landedCountries).toEqual({ scope: 'us', codes: [] })
    } finally {
      chmodSync(file, 0o644)
    }
  })

  it('falls back to the default settings only when nothing was ever stored', () => {
    // 「没配过」可以用默认；「读坏了」不行——后半条在坏文件那条用例里钉。
    const store = createCalendarReminderSettingsStore(join(dir, 'missing.json'))
    expect(store.read()).toEqual(DEFAULT_CALENDAR_REMINDER_SETTINGS)
  })
})
