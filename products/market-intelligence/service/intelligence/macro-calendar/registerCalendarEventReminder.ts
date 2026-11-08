
import type { JobRuntime } from '@platform/jobs'
import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'

import type { MarketCalendarPage, MarketCalendarQuery } from '../../../contracts/macro/marketCalendarQueryContracts'
import { DEFAULT_CALENDAR_LANDED_COUNTRIES, type CalendarLandedCountrySelection } from '../../../contracts/calendarLandedCountries'
import { DEFAULT_CALENDAR_REMINDER_SETTINGS, type CalendarReminderSettings } from '../../../contracts/calendarEventReminder'
import { registerCalendarEventReminderJob } from './calendarEventReminderJob'
import type { CalendarReminderEvent } from './calendarEventReminderScan'
import type { CalendarReminderSettingsStore } from './calendarEventReminderSettingsStore'

/**
 * 「日历事件开始前」提醒的装配（技术方案 §3）。
 *
 * 从 `bootstrap.ts` 抽出来，只为让那份文件的体积基线不再增长——接线本身没有变：
 * 一条开关一个 definition，注册时读一次设置（开着就排上，这就是「重启自行重建」）。
 */
/** 「事件发生后也告诉我」那一行的读取器：缺省＝只推出乎意料的、只推「高」（与从前一致）。 */
export function landedFilterReader(
  settings: CalendarReminderSettingsStore
): () => Readonly<{
  includeMatched: boolean
  importance: readonly ('high' | 'medium' | 'low')[]
  landedCountries: CalendarLandedCountrySelection
}> {
  return () => {
    const current = settings.readWithStatus()
    // 读不到按默认「只美国」处理：与「缺键 = 可读 + 默认」同一条规矩，也不放大推送量。
    if (current.state === 'unreadable') {
      return {
        includeMatched: false,
        importance: DEFAULT_CALENDAR_REMINDER_SETTINGS.importance,
        landedCountries: DEFAULT_CALENDAR_LANDED_COUNTRIES
      }
    }
    return {
      includeMatched: current.settings.landedFilter === 'also-matched',
      importance: current.settings.importance,
      landedCountries: current.settings.landedCountries
    }
  }
}

export type CalendarEventReminderWiring = Readonly<{
  read: () => CalendarReminderSettings
  write: (patch: Readonly<Partial<CalendarReminderSettings>>) => CalendarReminderSettings
  /** 读不到与"没存上"各自成结果：设置页据此区分，不许拿默认值冒充"读到了"。 */
  readWithStatus: CalendarReminderSettingsStore['readWithStatus']
  writeWithStatus: CalendarReminderSettingsStore['writeWithStatus']
  applySchedule: (enabled: boolean) => void
  /**
   * 提醒作业实际使用的那一份事件读取（当前月 + 下月、身份 `observationKey ?? eventKey`）。
   *
   * **就是交给作业的同一个函数，原样暴露**，供「通知测试」选样例：测试样例必须与真实提醒同源，
   * 在这里另写一份读取会让按钮演示一条读者不会收到的链。只读，不改作业的既有接线与行为。
   */
  readEvents: () => readonly CalendarReminderEvent[]
}>

export function registerCalendarEventReminder(input: Readonly<{
  jobRuntime: Pick<JobRuntime, 'registerHandler' | 'setSchedule' | 'removeSchedule'>
  /** 配置存储由装配处创建并共享（「发生后」那一行也读它），不在这里再建一份。 */
  settings: CalendarReminderSettingsStore
  queryMonth: (query: MarketCalendarQuery) => MarketCalendarPage
  submit: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome | unknown>
  timeZone: () => string
  now?: () => string
}>): CalendarEventReminderWiring {
  const now = input.now ?? (() => new Date().toISOString())
  const settings = input.settings

  /**
   * 只读当前月与下一个月：提醒窗口最多 120 分钟，跨月那几小时靠第二个月兜住。
   *
   * **身份用 `observationKey`（稳定）而不是 `eventKey`**：后者是每批采集的 HMAC，拿它做去重键
   * 会让同一条事件每一轮都变成「新事件」——同一件事被反复提醒，而且不报错。
   *
   * 提到这里只为一件事：让 `readEvents` 能原样交给调用方（见 `CalendarEventReminderWiring`），
   * 作业与测试样例因此读的是**同一个函数**，不是两份会各自漂移的实现。
   */
  const readEvents = (): readonly CalendarReminderEvent[] => {
    const at = new Date(now())
    const months = [at, new Date(at.getFullYear(), at.getMonth() + 1, 1)]
    const asOf = at.toISOString()
    const events = months.flatMap((month) => {
      const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`
      const page = input.queryMonth({ month: monthKey, locale: 'zh', asOf })
      return page.state === 'available' ? [...page.events] : []
    })
    return events.map((event) => ({
      eventKey: event.observationKey ?? event.eventKey,
      title: event.title,
      scheduledAt: event.scheduledAt,
      importance: event.importance
    }))
  }

  const job = registerCalendarEventReminderJob(input.jobRuntime, {
    readSettings: () => settings.read(),
    readEvents,
    submit: input.submit as never,
    now,
    timeZone: input.timeZone,
    log: (line) => {
      console.log(JSON.stringify({ marker: 'MI_CALENDAR_REMINDER', ...line }))
    }
  })
  return {
    read: () => settings.read(),
    write: (patch) => settings.write(patch),
    readWithStatus: () => settings.readWithStatus(),
    writeWithStatus: (patch) => settings.writeWithStatus(patch),
    applySchedule: job.applySchedule,
    readEvents
  }
}
