import { calendarDisplayDate } from './economicCalendarDayModel'
import type { EconomicCalendarEventView } from './economicCalendarModel'
import type { EconomicCalendarMonthState } from './useEconomicCalendarMonthWindow'

/**
 * 「读者选中的那条，从屏上这个月里读出来」——页面末尾那两个小映射，单独一处。
 *
 * 它们与页面的编排（查询、as-of、选择身份、抽屉）无关：只做「月份投影 + 事件键 → 详情要的东西」，
 * 所以从页面里搬出来，页面因此回到体积基线以内。两处读取仍只有一份实现，测试也直接盯这里。
 */

/** 官方事件画在哪一天，按工作区的显示时区算。 */
export function calendarEventDay(event: EconomicCalendarEventView, timeZone: string): string {
  return event.scheduledAt ? calendarDisplayDate(event.scheduledAt, timeZone) : event.scheduledDate
}

/**
 * 选中的那条官方事件；`version` 一路带着走，因为月份投影被替换时详情要重读。
 * 月份还没读到或不是 `available` 时返回 `undefined`——没有投影就没有可读的行。
 */
export function readSelectedEvent(state: EconomicCalendarMonthState, eventKey: string | undefined): { event: EconomicCalendarEventView; version: number } | undefined {
  if (!eventKey) return undefined
  if (state?.state !== 'available') return undefined
  const event = state.events.find((candidate) => candidate.eventKey === eventKey)
  return event ? { event, version: state.version } : undefined
}
