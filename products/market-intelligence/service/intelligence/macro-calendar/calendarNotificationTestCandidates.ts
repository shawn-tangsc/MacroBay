import { calendarReminderRemainingMinutes, selectCalendarReminderCandidates } from './calendarEventReminderScan'
import type { CalendarReminderEvent } from './calendarEventReminderScan'
import type { CalendarReminderImportance, CalendarReminderSettings } from '../../../contracts/calendarEventReminder'

/**
 * 「发送测试通知」按钮要用的两条**只读**样例数据：一条「临近提醒」，一条「结果公布」。
 *
 * 三条边界写死在这里，因为它们的区别对读者完全不同：
 *
 * 1. **只读**：本模块不触发采集、不写库、不重排任何作业——它只从一个已经读到的数组里挑一条。
 * 2. **源状态不合并**：源没启用、读不到、确实没有可提醒的事件，是三句话。把「没启用」写成
 *    「没有事件」，读者会去检查日历数据；把「读不到」写成「没有事件」，他会以为今天真没东西。
 * 3. **时区不在这里**：返回的是**时刻本体**（`scheduledAt` 的 UTC 值）。显示用的墙钟由上层按
 *    读者时区格式化；**取不到时区时不许拿 UTC 充当本地时间**，宁可只显示时刻本体并注明，
 *    也不要把 +08:00 的事件印成 08:00 的「本地」时间。
 */

export type CalendarTestSourceState = 'available' | 'disabled' | 'unreadable'

export type CalendarUpcomingTestCandidate =
  /** 落在提醒提前量之内的事件：上层直接用它，`remainingMinutes` 就是句子里那个数。 */
  | Readonly<{
      kind: 'reminder'
      eventKey: string
      title: string
      scheduledAt: string
      importance: CalendarReminderImportance
      /** 实际剩余分钟（取整，最小 1）——来自候选选择，不另算一份。 */
      remainingMinutes: number
    }>
  /**
   * 12 小时内没有可提醒的候选时的兜底：最近的一条**未来**事件。
   * `scheduledAt` 是它的真实发生时间，上层必须印出来——否则读者会以为「马上就会提醒」。
   */
  | Readonly<{
      kind: 'nearest-future'
      eventKey: string
      title: string
      scheduledAt: string
      importance: CalendarReminderImportance
      minutesUntil: number
    }>
  /** 真的没有未来事件（读完整个窗口都没有）。这一档不能和「源没启用 / 读不到」共用一句话。 */
  | Readonly<{ kind: 'none-upcoming' }>
  | Readonly<{ kind: 'source-disabled' }>
  | Readonly<{ kind: 'unreadable' }>

/** 「结果公布」样例需要的字段：它只认有实际值的事件，所以 `actual` 必须在这里。 */
export type CalendarLandedTestEvent = Readonly<{
  eventKey: string
  title: string
  scheduledAt?: string
  importance: CalendarReminderImportance
  actual?: Readonly<{ displayValue: string }> | null
}>

export type CalendarLandedTestCandidate =
  | Readonly<{
      kind: 'landed'
      eventKey: string
      title: string
      scheduledAt: string
      importance: CalendarReminderImportance
      /** 实际值原文，与事件详情里显示的是同一个字段。 */
      actual: string
    }>
  | Readonly<{ kind: 'none-landed' }>
  | Readonly<{ kind: 'source-disabled' }>
  | Readonly<{ kind: 'unreadable' }>

/** 兜底窗口：这么远之内没有候选，就不假装「马上要提醒」，改印真实时间。 */
export const CALENDAR_TEST_FALLBACK_WINDOW_MS = 12 * 3_600_000

/**
 * 事前：提醒提前量之内最近的一条事件；没有就退到最近的未来一条并带真实时间；再没有就是没有。
 *
 * `events` 由调用方用现有的只读来源给出（`calendarEventReminderJob` 的 `readEvents`）。
 * 候选判定**复用** `selectCalendarReminderCandidates`：窗口、已开始、重要性都在那一处定义，
 * 这里不写第二份口径；`remainingMinutes` 也直接取它的结果。
 */
export function calendarUpcomingTestCandidate(input: Readonly<{
  now: string
  source: CalendarTestSourceState
  settings: CalendarReminderSettings
  events: readonly CalendarReminderEvent[]
}>): CalendarUpcomingTestCandidate {
  // 源状态先判：没启用 / 读不到都有自己的句子，绝不落到「没有事件」。
  if (input.source === 'disabled') return Object.freeze({ kind: 'source-disabled' as const })
  if (input.source === 'unreadable') return Object.freeze({ kind: 'unreadable' as const })
  const nowMs = Date.parse(input.now)
  if (!Number.isFinite(nowMs)) return Object.freeze({ kind: 'unreadable' as const })

  const { candidates } = selectCalendarReminderCandidates({ events: input.events, settings: input.settings, now: input.now })
  const inWindow = [...candidates]
    .filter((candidate) => Date.parse(candidate.scheduledAt) - nowMs <= CALENDAR_TEST_FALLBACK_WINDOW_MS)
    .sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt))
  const first = inWindow[0]
  if (first) {
    return Object.freeze({ kind: 'reminder' as const, eventKey: first.eventKey, title: first.title,
      scheduledAt: first.scheduledAt, importance: first.importance, remainingMinutes: first.remainingMinutes })
  }

  // 没有候选：退到最近的一条未来事件，并把它的真实时间交出去。
  const nearest = input.events
    .map((event) => ({ event, scheduledMs: event.scheduledAt === undefined ? Number.NaN : Date.parse(event.scheduledAt) }))
    .filter((entry): entry is { event: CalendarReminderEvent & { scheduledAt: string }; scheduledMs: number } =>
      Number.isFinite(entry.scheduledMs) && entry.scheduledMs > nowMs)
    .sort((left, right) => left.scheduledMs - right.scheduledMs)[0]
  if (!nearest) return Object.freeze({ kind: 'none-upcoming' as const })
  return Object.freeze({ kind: 'nearest-future' as const, eventKey: nearest.event.eventKey, title: nearest.event.title,
    scheduledAt: nearest.event.scheduledAt, importance: nearest.event.importance,
    minutesUntil: calendarReminderRemainingMinutes(nearest.scheduledMs, nowMs) })
}

/**
 * 事后：最近一条**已经落地**的事件（时间已过、且有实际值）。
 *
 * 「已落地」= 时刻已过 **且** `actual.displayValue` 有内容。时间过了但没有实际值的，属于
 * 「还没公布」，不是「最近的结果」——拿它当样例，读者点一下会看到一条空结果通知。
 */
export function calendarLandedTestCandidate(input: Readonly<{
  now: string
  source: CalendarTestSourceState
  events: readonly CalendarLandedTestEvent[]
}>): CalendarLandedTestCandidate {
  if (input.source === 'disabled') return Object.freeze({ kind: 'source-disabled' as const })
  if (input.source === 'unreadable') return Object.freeze({ kind: 'unreadable' as const })
  const nowMs = Date.parse(input.now)
  if (!Number.isFinite(nowMs)) return Object.freeze({ kind: 'unreadable' as const })

  const landed = input.events
    .map((event) => ({ event, scheduledMs: event.scheduledAt === undefined ? Number.NaN : Date.parse(event.scheduledAt) }))
    .filter((entry): entry is { event: CalendarLandedTestEvent & { scheduledAt: string }; scheduledMs: number } =>
      Number.isFinite(entry.scheduledMs) && entry.scheduledMs <= nowMs)
    .filter(({ event }) => (event.actual?.displayValue.trim() ?? '') !== '')
    .sort((left, right) => right.scheduledMs - left.scheduledMs)
  const latest = landed[0]
  if (!latest) return Object.freeze({ kind: 'none-landed' as const })
  return Object.freeze({ kind: 'landed' as const, eventKey: latest.event.eventKey, title: latest.event.title,
    scheduledAt: latest.event.scheduledAt, importance: latest.event.importance,
    actual: latest.event.actual!.displayValue })
}
