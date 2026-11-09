import type { JobRuntime } from '@platform/jobs'
import type { NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'

import type { CalendarReminderSettings } from '../../../contracts/calendarEventReminder'
import { renderCalendarReminderSentence } from './calendarEventReminderCopy'
import {
  selectCalendarReminderCandidates,
  type CalendarReminderCandidate,
  type CalendarReminderEvent,
  type CalendarReminderSkipReason
} from './calendarEventReminderScan'

/**
 * 日历事件「开始前」提醒的排程与提交（技术方案 §3）。
 *
 * 三条硬规矩：
 * - **一条开关一个 definition**：开着 `setSchedule`、关掉 `removeSchedule`，不留常驻作业靠 handler 过滤；
 * - **重启自己重建**：注册时读一次设置，开着就排上——「关掉应用再开，提醒仍然会来」是判据；
 * - **handler 只做一件事**：算窗口 → 取事件 → 逐条提交。不采集、不重新排自己。
 */

export const CALENDAR_EVENT_REMINDER_JOB_ID = 'market-intelligence.calendar-event-reminder'

/** 5 分钟扫描：最小提前档 15 分钟下不会漏窗，也不承诺做不到的精度（没有 5 分钟提前档）。 */
export const CALENDAR_EVENT_REMINDER_INTERVAL_MS = 5 * 60_000

export const CALENDAR_EVENT_UPCOMING_EVENT_ID = 'market-intelligence.calendar.event-upcoming'

export function calendarEventReminderDefinition(): Readonly<Record<string, unknown>> {
  return {
    id: CALENDAR_EVENT_REMINDER_JOB_ID,
    owner: 'product' as const,
    productId: 'market-intelligence',
    handlerId: CALENDAR_EVENT_REMINDER_JOB_ID,
    // 作业名必须双语（`job-title-localization-contract.md`）：运行日志与定时任务页都直接显示它，
    // 单写英文等于界面上出现内部名。
    title: { 'zh-CN': '日历事件提醒', 'en-US': 'Calendar event reminder' },
    audience: 'user' as const,
    trigger: { kind: 'interval' as const, intervalMs: CALENDAR_EVENT_REMINDER_INTERVAL_MS, anchor: 'lastComplete' as const },
    payload: {}
  }
}

/**
 * 读设置只有两种结果，**没有「默认值」这一种**：文件坏了不等于读者关掉了。
 * 读不到时调用方不许当成 `enabled: false`。
 */
export type CalendarReminderSettingsRead =
  | Readonly<{ state: 'readable'; settings: CalendarReminderSettings }>
  | Readonly<{ state: 'unreadable' }>

export type CalendarEventReminderDeps = Readonly<{
  readSettings: () => CalendarReminderSettingsRead
  /** 未来窗口内的事件；调用方只给这段窗口，本模块不负责翻页。 */
  readEvents: () => readonly CalendarReminderEvent[]
  submit: (request: NotificationSubmitRequest) => Promise<unknown>
  now: () => string
  /** 读者设置时区；**只用于显示**，判断只认 UTC。 */
  timeZone: () => string
  log?: (line: Readonly<{ kind: 'skipped'; reason: CalendarReminderSkipReason; count: number } | { kind: 'submitted'; count: number }>) => void
}>

export type CalendarEventReminderRunResult = Readonly<{
  submitted: readonly CalendarReminderCandidate[]
  skipped: Readonly<Partial<Record<CalendarReminderSkipReason, number>>>
}>

/** 一条候选 → 一次提交：成品句子在源头拼好（中英各一份），平台只挑一份。 */
export function buildCalendarReminderRequest(
  candidate: CalendarReminderCandidate,
  deps: Pick<CalendarEventReminderDeps, 'now' | 'timeZone'>
): NotificationSubmitRequest {
  return {
    eventTypeId: CALENDAR_EVENT_UPCOMING_EVENT_ID,
    dedupeVars: { builder: 'template', vars: { eventKey: candidate.eventKey, scheduledAt: candidate.scheduledAt } },
    rendered: renderCalendarReminderSentence({ candidate, timeZone: deps.timeZone() }),
    actions: [],
    // 通知描述的是「什么时候开始」，不是这一下扫描的时刻。
    occurredAt: deps.now()
  }
}

export function registerCalendarEventReminderJob(
  jobRuntime: Pick<JobRuntime, 'registerHandler' | 'setSchedule' | 'removeSchedule'>,
  deps: CalendarEventReminderDeps
): Readonly<{
  runOnce: () => Promise<CalendarEventReminderRunResult>
  applySchedule: (enabled: boolean) => void
}> {
  const runOnce = async (): Promise<CalendarEventReminderRunResult> => {
    const read = deps.readSettings()
    // 读不到设置：这一轮**什么都不判**。既不说「关着」（那是替读者关掉提醒），也不按默认去推。
    // 页面那一行会显示「读不到」，日志里留一条，读者与诊断都看得见。
    if (read.state === 'unreadable') {
      deps.log?.({ kind: 'skipped', reason: 'settings-unreadable', count: 1 })
      return { submitted: [], skipped: { 'settings-unreadable': 1 } }
    }
    const settings = read.settings
    const selection = selectCalendarReminderCandidates({
      events: settings.enabled ? deps.readEvents() : [],
      settings,
      now: deps.now()
    })
    for (const [reason, count] of Object.entries(selection.skipped)) {
      if (count > 0) deps.log?.({ kind: 'skipped', reason: reason as CalendarReminderSkipReason, count })
    }
    const submitted: CalendarReminderCandidate[] = []
    for (const candidate of selection.candidates) {
      // 一条提交失败不该让这一批剩下的都不发：每条独立，失败留给下一轮（键相同→合并）。
      try {
        await deps.submit(buildCalendarReminderRequest(candidate, deps))
        submitted.push(candidate)
      } catch {
        // 采集与日历本身不受影响；平台的诊断里有这次失败。
      }
    }
    if (submitted.length > 0) deps.log?.({ kind: 'submitted', count: submitted.length })
    return { submitted, skipped: selection.skipped }
  }

  jobRuntime.registerHandler(CALENDAR_EVENT_REMINDER_JOB_ID, async () => { await runOnce() })

  const applySchedule = (enabled: boolean): void => {
    if (enabled) jobRuntime.setSchedule(calendarEventReminderDefinition() as never)
    else jobRuntime.removeSchedule(CALENDAR_EVENT_REMINDER_JOB_ID)
  }

  // 重启自行重建：注册发生在每次启动，开着就排上；关着就确保没有残留。
  // **读不到时不动排程**：当成关着会把提醒静默停掉，当成开着会推读者没要的——两种都是编事实。
  const boot = deps.readSettings()
  if (boot.state === 'readable') applySchedule(boot.settings.enabled)
  else deps.log?.({ kind: 'skipped', reason: 'settings-unreadable', count: 1 })

  return { runOnce, applySchedule }
}
