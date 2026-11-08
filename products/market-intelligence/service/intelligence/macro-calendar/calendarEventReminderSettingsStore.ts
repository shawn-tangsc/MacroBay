import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { normalizeCalendarLandedCountries } from '../../../contracts/calendarLandedCountries'
import {
  CALENDAR_REMINDER_LEAD_MINUTES,
  DEFAULT_CALENDAR_REMINDER_SETTINGS,
  isCalendarReminderImportance,
  isCalendarReminderLeadMinutes,
  type CalendarLandedFilter,
  type CalendarReminderImportance,
  type CalendarReminderSettings
} from '../../../contracts/calendarEventReminder'

/**
 * 「日历事件 · 开始前」提醒的配置存储。
 *
 * 三条规矩：
 * - **读坏了一律回默认值**，不抛：配置文件坏掉不该让设置页打不开；但**默认值是「关」**，
 *   所以「读不到」不会变成「悄悄替你打开」。
 * - **写只接受合法值**：提前量不在 15/30/60/120 里就保持原值；重要性去重、只留三档；
 *   非法输入不写入，也不静默替换成一个看起来合理的数。
 * - **表面选择不在这里**：它由平台按组键存（同一件事不该有第二个落点），产品只读不算存。
 */

/**
 * 「没读到」与「没存上」是两个结果，不是两个异常：
 * - 读：文件不存在（首次运行）＝**可读 + 默认值**；文件坏了/没权限＝`unreadable`。
 * - 写：失败时磁盘上的旧值原样生效，`not-saved` 告诉调用方"这次没存上"，界面据此保留读者刚选的值。
 * `read` / `write` 保留给既有调用方（失败仍抛/回默认），新的两个 `*WithStatus` 供设置页与 IPC 用。
 */
export type CalendarReminderReadResult =
  | Readonly<{ state: 'readable'; settings: CalendarReminderSettings }>
  | Readonly<{ state: 'unreadable' }>

export type CalendarReminderWriteResult =
  | Readonly<{ state: 'saved'; settings: CalendarReminderSettings }>
  | Readonly<{ state: 'not-saved'; settings: CalendarReminderSettings }>

export type CalendarReminderSettingsStore = Readonly<{
  read: () => CalendarReminderSettings
  /** 局部更新：只改传进来的字段，其余保持。返回写入后的完整设置。 */
  write: (patch: Readonly<Partial<CalendarReminderSettings>>) => CalendarReminderSettings
  readWithStatus: () => CalendarReminderReadResult
  writeWithStatus: (patch: Readonly<Partial<CalendarReminderSettings>>) => CalendarReminderWriteResult
}>

type StoredShape = Partial<{
  enabled: unknown
  leadMinutes: unknown
  importance: unknown
  landedFilter: unknown
  landedCountries: unknown
}>

function normalizeImportance(value: unknown): readonly CalendarReminderImportance[] | undefined {
  if (!Array.isArray(value)) return undefined
  const known: CalendarReminderImportance[] = []
  for (const entry of value) {
    if (isCalendarReminderImportance(entry) && !known.includes(entry)) known.push(entry)
  }
  // 全是不认识的档位时不返回空数组：空数组等于「一个都不推」，和「配置写坏了」是两件事。
  return known.length > 0 ? known : undefined
}

function isCalendarLandedFilter(value: unknown): value is CalendarLandedFilter {
  return value === 'surprise-only' || value === 'also-matched'
}

function normalize(stored: StoredShape): CalendarReminderSettings {
  return {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULT_CALENDAR_REMINDER_SETTINGS.enabled,
    leadMinutes: isCalendarReminderLeadMinutes(stored.leadMinutes)
      ? stored.leadMinutes
      : DEFAULT_CALENDAR_REMINDER_SETTINGS.leadMinutes,
    importance: normalizeImportance(stored.importance) ?? DEFAULT_CALENDAR_REMINDER_SETTINGS.importance,
    landedFilter: isCalendarLandedFilter(stored.landedFilter) ? stored.landedFilter : DEFAULT_CALENDAR_REMINDER_SETTINGS.landedFilter,
    // 缺键（老文件没有这一项）= 可读 + 默认「只美国」，不是读失败，也不迁移。
    landedCountries: normalizeCalendarLandedCountries(stored.landedCountries)
  }
}

export function createCalendarReminderSettingsStore(filePath: string): CalendarReminderSettingsStore {
  const readWithStatus = (): CalendarReminderReadResult => {
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object') return { state: 'unreadable' }
      return { state: 'readable', settings: normalize(parsed as StoredShape) }
    } catch (error) {
      // 首次运行没有这个文件＝可读 + 默认值；其余（坏 JSON、没权限）才是真的读不到。
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { state: 'readable', settings: DEFAULT_CALENDAR_REMINDER_SETTINGS }
      }
      return { state: 'unreadable' }
    }
  }

  // 既有调用方要的是「总能拿到一份可用设置」：读不到也回默认（默认是关，不会悄悄打开）。
  const read = (): CalendarReminderSettings => {
    const result = readWithStatus()
    return result.state === 'readable' ? result.settings : DEFAULT_CALENDAR_REMINDER_SETTINGS
  }

  const writeWithStatus = (patch: Readonly<Partial<CalendarReminderSettings>>): CalendarReminderWriteResult => {
    const current = read()
    const next: CalendarReminderSettings = {
      enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
      leadMinutes: isCalendarReminderLeadMinutes(patch.leadMinutes) ? patch.leadMinutes : current.leadMinutes,
      importance: patch.importance === undefined ? current.importance : normalizeImportance(patch.importance) ?? current.importance,
      landedFilter: isCalendarLandedFilter(patch.landedFilter) ? patch.landedFilter : current.landedFilter,
      // 未知档位/未知国家码回默认（可读、不迁移），而不是把非法值写进文件。
      landedCountries: patch.landedCountries === undefined
        ? current.landedCountries
        : normalizeCalendarLandedCountries(patch.landedCountries)
    }
    try {
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, JSON.stringify(next), 'utf8')
      return { state: 'saved', settings: next }
    } catch {
      // 写失败：磁盘上的旧值原样生效，明确告诉调用方"没存上"，不假装成功。
      return { state: 'not-saved', settings: current }
    }
  }

  return {
    read,
    write(patch) {
      const result = writeWithStatus(patch)
      if (result.state === 'not-saved') throw new Error('calendar-reminder-settings-not-saved')
      return result.settings
    },
    readWithStatus,
    writeWithStatus
  }
}

/** 提前档的对外清单：页面按它渲染选项，避免页面自己写死一份数字。 */
export function calendarReminderLeadOptions(): readonly number[] {
  return CALENDAR_REMINDER_LEAD_MINUTES
}
