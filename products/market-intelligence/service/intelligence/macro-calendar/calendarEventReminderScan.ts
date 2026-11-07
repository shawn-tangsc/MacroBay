import {
  CALENDAR_REMINDER_LEAD_MINUTES,
  type CalendarReminderImportance,
  type CalendarReminderLeadMinutes,
  type CalendarReminderSettings
} from '../../../contracts/calendarEventReminder'

/**
 * 「日历事件开始前」的扫描判定（技术方案 §4–§6）。
 *
 * 只有一处时间基准：**`scheduledAt` 的 UTC 值**。`scheduledAt - now` 决定「还有多久」，
 * 与读者时区无关——拿读者时区参与判断，改时区就会漏提醒或重提醒，而改时区不该改变「什么时候到点」。
 *
 * 扫到就说的那条边界写死在这里：**只有 `scheduledAt > now` 才可能提醒**——已经开始的事件一律不提醒，
 * 哪怕它只差 1 秒。这不是「补发开关」，是同一个判断的自然结果。
 */

/** 扫描只需要这四样；多一样就说明有人在拿提醒做别的事。 */
export type CalendarReminderEvent = Readonly<{
  eventKey: string
  title: string
  scheduledAt?: string
  importance: CalendarReminderImportance
}>

export type CalendarReminderCandidate = Readonly<{
  eventKey: string
  title: string
  scheduledAt: string
  importance: CalendarReminderImportance
  /** **实际剩余分钟**（取整到分钟，最小 1）：句子里的数用它，不用配置档位。 */
  remainingMinutes: number
  /** `calendar-upcoming:{eventKey}:{scheduledAt}`——**不含提前量**。 */
  dedupeKey: string
}>

export type CalendarReminderSkipReason =
  | 'reminder-disabled'
  | 'missing-schedule'
  | 'already-started'
  | 'outside-window'
  | 'importance-not-selected'

export type CalendarReminderSelection = Readonly<{
  candidates: readonly CalendarReminderCandidate[]
  /** 每种原因各跳过几条；「扫得对」与「读漏了」必须在日志里长得不一样。 */
  skipped: Readonly<Partial<Record<CalendarReminderSkipReason, number>>>
}>

export function calendarReminderDedupeKey(input: Readonly<{ eventKey: string; scheduledAt: string }>): string {
  return `calendar-upcoming:${input.eventKey}:${input.scheduledAt}`
}

/** 实际剩余分钟：向上取整，最小 1——不写「0 分钟后」，那等于说「已经开始了」。 */
export function calendarReminderRemainingMinutes(scheduledAtMs: number, nowMs: number): number {
  return Math.max(1, Math.ceil((scheduledAtMs - nowMs) / 60_000))
}

export function selectCalendarReminderCandidates(input: Readonly<{
  events: readonly CalendarReminderEvent[]
  settings: CalendarReminderSettings
  now: string
}>): CalendarReminderSelection {
  const nowMs = Date.parse(input.now)
  if (!Number.isFinite(nowMs)) return { candidates: [], skipped: {} }
  if (!input.settings.enabled) {
    return { candidates: [], skipped: input.events.length === 0 ? {} : { 'reminder-disabled': input.events.length } }
  }

  const leadMs = input.settings.leadMinutes * 60_000
  const candidates: CalendarReminderCandidate[] = []
  const skipped: Partial<Record<CalendarReminderSkipReason, number>> = {}
  const skip = (reason: CalendarReminderSkipReason): void => {
    skipped[reason] = (skipped[reason] ?? 0) + 1
  }

  for (const event of input.events) {
    if (event.scheduledAt === undefined || event.scheduledAt.trim() === '') {
      // 没有时刻就**不猜**：只记一条「跳过了」，不拿日期当时刻。
      skip('missing-schedule')
      continue
    }
    const scheduledMs = Date.parse(event.scheduledAt)
    if (!Number.isFinite(scheduledMs)) {
      skip('missing-schedule')
      continue
    }
    // 已经开始的绝不提醒——这是边界，不是偏好。
    if (scheduledMs <= nowMs) {
      skip('already-started')
      continue
    }
    if (scheduledMs - nowMs > leadMs) {
      skip('outside-window')
      continue
    }
    if (!input.settings.importance.includes(event.importance)) {
      skip('importance-not-selected')
      continue
    }
    candidates.push({
      eventKey: event.eventKey,
      title: event.title,
      scheduledAt: event.scheduledAt,
      importance: event.importance,
      remainingMinutes: calendarReminderRemainingMinutes(scheduledMs, nowMs),
      dedupeKey: calendarReminderDedupeKey({ eventKey: event.eventKey, scheduledAt: event.scheduledAt })
    })
  }

  return { candidates, skipped }
}

/** 提前档只有这四个；页面按它渲染选项，不自己写死一份。 */
export function calendarReminderLeadChoices(): readonly CalendarReminderLeadMinutes[] {
  return CALENDAR_REMINDER_LEAD_MINUTES
}
