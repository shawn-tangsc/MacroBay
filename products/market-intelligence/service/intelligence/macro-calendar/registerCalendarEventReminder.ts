import { join } from 'node:path'

import type { JobRuntime } from '@platform/jobs'
import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'

import type { MarketCalendarPage, MarketCalendarQuery } from '../../../contracts/macro/marketCalendarQueryContracts'
import type { CalendarReminderSettings } from '../../../contracts/calendarEventReminder'
import { registerCalendarEventReminderJob } from './calendarEventReminderJob'
import { createCalendarReminderSettingsStore } from './calendarEventReminderSettingsStore'

/**
 * 「日历事件开始前」提醒的装配（技术方案 §3）。
 *
 * 从 `bootstrap.ts` 抽出来，只为让那份文件的体积基线不再增长——接线本身没有变：
 * 一条开关一个 definition，注册时读一次设置（开着就排上，这就是「重启自行重建」）。
 */
export type CalendarEventReminderWiring = Readonly<{
  read: () => CalendarReminderSettings
  write: (patch: Readonly<Partial<CalendarReminderSettings>>) => CalendarReminderSettings
  applySchedule: (enabled: boolean) => void
}>

export function registerCalendarEventReminder(input: Readonly<{
  jobRuntime: Pick<JobRuntime, 'registerHandler' | 'setSchedule' | 'removeSchedule'>
  dataDir: string
  queryMonth: (query: MarketCalendarQuery) => MarketCalendarPage
  submit: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome | unknown>
  timeZone: () => string
  now?: () => string
}>): CalendarEventReminderWiring {
  const settings = createCalendarReminderSettingsStore(join(input.dataDir, 'calendar-event-reminder.json'))
  const now = input.now ?? (() => new Date().toISOString())

  const job = registerCalendarEventReminderJob(input.jobRuntime, {
    readSettings: () => settings.read(),
    /**
     * 只读当前月与下一个月：提醒窗口最多 120 分钟，跨月那几小时靠第二个月兜住。
     *
     * **身份用 `observationKey`（稳定）而不是 `eventKey`**：后者是每批采集的 HMAC，拿它做去重键
     * 会让同一条事件每一轮都变成「新事件」——同一件事被反复提醒，而且不报错。
     */
    readEvents: () => {
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
    },
    submit: input.submit as never,
    now,
    timeZone: input.timeZone,
    log: (line) => {
      console.log(JSON.stringify({ marker: 'MI_CALENDAR_REMINDER', ...line }))
    }
  })
  return { read: () => settings.read(), write: (patch) => settings.write(patch), applySchedule: job.applySchedule }
}
