import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
 * 四条规矩（2026-11-09 存储审计后重定，此前三条会静默关掉读者的提醒）：
 * - **「从没配过」与「读失败」是两件事**：文件不存在＝可读 + 默认值（默认是关，只对"没配过"成立）；
 *   文件坏了/没权限＝`unreadable`。`read()` **不再**把读失败伪装成默认值——它直接抛，让上层知道读不到。
 * - **读不到时拒绝保存**：不拿默认值打底整份写回。那份文件里可能是读者真正设过的值，用默认覆盖
 *   等于把「读者关掉了」写死，而他察觉不到，只表现成「该响没响」。
 * - **判定损坏先留副本**：把原文件按时间戳另存 `${filePath}.corrupt-*`（与平台
 *   `jsonFileStorage` 同一口径：不改原文件、只留证据）。留档失败＝fail-closed：这一份按读不到处理，
 *   并且绝不写它。
 * - **写只接受合法值**：提前量不在 15/30/60/120 里就保持原值；重要性去重、只留三档。
 */

export type CalendarReminderReadResult =
  | Readonly<{ state: 'readable'; settings: CalendarReminderSettings }>
  | Readonly<{ state: 'unreadable'; reason: 'corrupt' | 'io' }>

/**
 * 「没存上」现在分两种：`unreadable`＝原文件读不出来，**我们拒绝覆盖**（文件一个字节没动）；
 * `write-failed`＝读到了、写盘失败。两种都不假装成功，也都不回默认值。
 */
export type CalendarReminderWriteResult =
  | Readonly<{ state: 'saved'; settings: CalendarReminderSettings }>
  | Readonly<{ state: 'not-saved'; reason: 'unreadable' }>
  | Readonly<{ state: 'not-saved'; reason: 'write-failed'; settings: CalendarReminderSettings }>

export type CalendarReminderSettingsStore = Readonly<{
  /**
   * 读者的设置。**读不到时抛 `calendar-reminder-settings-unreadable`**：调用方不许拿到一份
   * 看起来像默认值的设置。要自己处理读失败就用 `readWithStatus`。
   */
  read: () => CalendarReminderSettings
  /** 局部更新：只改传进来的字段，其余保持。返回写入后的完整设置；没存上就抛。 */
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
  /** 这次进程里已经留过副本了就不再留：每 5 分钟一次提醒扫描会把同一个坏文件复制成一堆残片。 */
  let quarantined = false

  /** 把坏文件原样留一份。**失败即返回 false**，调用方据此 fail-closed（按读不到处理，绝不写）。 */
  const quarantineCorrupt = (raw: string): boolean => {
    if (quarantined) return true
    try {
      writeFileSync(`${filePath}.corrupt-${Date.now()}`, raw, 'utf8')
      quarantined = true
      return true
    } catch {
      return false
    }
  }

  const readWithStatus = (): CalendarReminderReadResult => {
    let raw: string
    try {
      raw = readFileSync(filePath, 'utf8')
    } catch (error) {
      // 首次运行没有这个文件＝可读 + 默认值；其余（没权限、磁盘错）才是真的读不到。
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { state: 'readable', settings: DEFAULT_CALENDAR_REMINDER_SETTINGS }
      }
      return { state: 'unreadable', reason: 'io' }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      // 坏 JSON：先留副本（留档失败也算读不到，且写侧会因为 unreadable 而拒绝保存）。
      return quarantineCorrupt(raw) ? { state: 'unreadable', reason: 'corrupt' } : { state: 'unreadable', reason: 'io' }
    }
    if (!parsed || typeof parsed !== 'object') {
      // 合法 JSON 但不是对象：同样判定为损坏，同样先留副本。
      return quarantineCorrupt(raw) ? { state: 'unreadable', reason: 'corrupt' } : { state: 'unreadable', reason: 'io' }
    }
    return { state: 'readable', settings: normalize(parsed as StoredShape) }
  }

  const read = (): CalendarReminderSettings => {
    const result = readWithStatus()
    // 读不到**不伪装成默认值**（默认是「关」，装成默认等于替读者关掉提醒）。
    if (result.state === 'unreadable') throw new Error('calendar-reminder-settings-unreadable')
    return result.settings
  }

  const writeWithStatus = (patch: Readonly<Partial<CalendarReminderSettings>>): CalendarReminderWriteResult => {
    const loaded = readWithStatus()
    // 读不到就拒绝保存：原文件一个字节都不动。拿默认打底写回会把「读坏了」写成「读者关掉了」。
    if (loaded.state === 'unreadable') return { state: 'not-saved', reason: 'unreadable' }
    const current = loaded.settings
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
      return { state: 'not-saved', reason: 'write-failed', settings: current }
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
