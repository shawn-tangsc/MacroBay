import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

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

export type CalendarReminderSettingsStore = Readonly<{
  read: () => CalendarReminderSettings
  /** 局部更新：只改传进来的字段，其余保持。返回写入后的完整设置。 */
  write: (patch: Readonly<Partial<CalendarReminderSettings>>) => CalendarReminderSettings
}>

type StoredShape = Partial<{
  enabled: unknown
  leadMinutes: unknown
  importance: unknown
  landedFilter: unknown
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
    landedFilter: isCalendarLandedFilter(stored.landedFilter) ? stored.landedFilter : DEFAULT_CALENDAR_REMINDER_SETTINGS.landedFilter
  }
}

export function createCalendarReminderSettingsStore(filePath: string): CalendarReminderSettingsStore {
  const read = (): CalendarReminderSettings => {
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object') return DEFAULT_CALENDAR_REMINDER_SETTINGS
      return normalize(parsed as StoredShape)
    } catch {
      // 不存在 / 读坏 / 不是 JSON：都回默认（关），不抛、也不猜。
      return DEFAULT_CALENDAR_REMINDER_SETTINGS
    }
  }

  return {
    read,
    write(patch) {
      const current = read()
      const next: CalendarReminderSettings = {
        enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
        leadMinutes: isCalendarReminderLeadMinutes(patch.leadMinutes) ? patch.leadMinutes : current.leadMinutes,
        importance: patch.importance === undefined ? current.importance : normalizeImportance(patch.importance) ?? current.importance,
        landedFilter: isCalendarLandedFilter(patch.landedFilter) ? patch.landedFilter : current.landedFilter
      }
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, JSON.stringify(next), 'utf8')
      return next
    }
  }
}

/** 提前档的对外清单：页面按它渲染选项，避免页面自己写死一份数字。 */
export function calendarReminderLeadOptions(): readonly number[] {
  return CALENDAR_REMINDER_LEAD_MINUTES
}
