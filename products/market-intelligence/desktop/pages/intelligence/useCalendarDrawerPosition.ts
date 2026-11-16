import { useEffect, useMemo, useRef, useState } from 'react'

import type { MarketCalendarEvent } from '../../../contracts/macro/marketCalendarQueryContracts'
import { calendarDisplayDate } from '../../features/macro/economic-calendar/economicCalendarDayModel'
import { defaultDayFor, type CalendarDrawerRequest } from './macroIndicatorDrawerModel'
import { useCalendarMonthReleases, type CalendarMonthReleases } from './useCalendarMonthReleases'

/**
 * 抽屉「看到哪」：哪个月、右列列哪一天、左缘那扇详情开着哪一条。
 *
 * 单拉出来有两个原因。一是这一块是一整条状态机，入口带定位、读者自己翻月、关抽屉时清干净，
 * 三者必须一起讲才讲得清；二是 `MacroIndicatorDrawer` 已经顶到 500 行的体积门禁，而这块
 * 正是它里面唯一**不属于渲染**的一段。视图那边只剩「把这个月画出来」。
 *
 * 月份与它的读数是同一件事（读数按 `month` 发），所以读也在这里，避免两处各存一份月份。
 */
export type CalendarDrawerPosition = Readonly<{
  /** 正在看的月份（显示时区，`YYYY-MM`）。 */
  month: string
  /** 这个月的读数。 */
  releases: CalendarMonthReleases
  /** 右列正在列的那一天（`YYYY-MM-DD`）。 */
  selectedDay: string
  /** 这一天是读者自己点的（`true`），还是抽屉按「今天 / 最近有事件的一天」替他挑的（`false`）。 */
  dayWasPicked: boolean
  /** 那一天的事件，按时刻升序。 */
  dayEvents: readonly MarketCalendarEvent[]
  /** 左缘那扇事件详情正在看的那条；没开就是 `undefined`。 */
  detailEvent: MarketCalendarEvent | undefined
  changeMonth: (month: string) => void
  selectDay: (day: string) => void
  selectEvent: (event: MarketCalendarEvent | undefined) => void
  /** 关抽屉时清干净：详情是挂到 `document.body` 的整窗浮层，不跟着抽屉卸载。 */
  clear: () => void
}>

export function useCalendarDrawerPosition(input: Readonly<{
  open: boolean
  openTarget?: CalendarDrawerRequest
  /** 显示时区的今天（`YYYY-MM-DD`）。 */
  today: string
  timeZone: string
  /** 按月读的快照时刻，必须是稳定值（每次渲染都变会让它无限重读）。 */
  asOf: string
  locale: 'zh-CN' | 'en-US'
  readMarketEvents?: (month: string, asOf: string) => Promise<readonly unknown[] | null>
}>): CalendarDrawerPosition {
  const { open, openTarget, today, timeZone, asOf, locale, readMarketEvents } = input
  // 月份与选中日是两个真状态：换月清掉选中的那一天，由「今天 / 最近一个有事件的日子」重新定。
  const [month, setMonth] = useState(today.slice(0, 7))
  const [pickedDay, setPickedDay] = useState<Readonly<{ month: string; day: string }> | undefined>(undefined)
  const [detailEvent, setDetailEvent] = useState<MarketCalendarEvent | undefined>(undefined)
  const releases = useCalendarMonthReleases({
    enabled: open,
    month,
    asOf,
    locale,
    ...(readMarketEvents === undefined ? {} : { readMarketEvents })
  })
  const eventDays = useMemo(() => new Set(releases.events.map((event) => calendarDisplayDate(event.scheduledAt, timeZone))),
    [releases.events, timeZone])
  const selectedDay = pickedDay !== undefined && pickedDay.month === month
    ? pickedDay.day
    : defaultDayFor(month, eventDays, today)
  const dayEvents = useMemo(() => releases.events
    .filter((event) => calendarDisplayDate(event.scheduledAt, timeZone) === selectedDay)
    .sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt)),
  [releases.events, selectedDay, timeZone])

  /**
   * 入口带定位（用户 2026-11-16 判为缺陷：点了卡片那颗图标，抽屉打开却停在别的月份）。
   *
   * 只在**请求序号变化**时落一次：读者自己翻过月份之后，页面为别的原因重渲染，定位再落一次
   * 就成了「我明明翻走了，又被拽回来」。同一个目标再点一次，序号会加一，照样生效。
   */
  const appliedRequestSeq = useRef(0)
  const [pendingEventKey, setPendingEventKey] = useState<Readonly<{ month: string; eventKey: string }> | undefined>(undefined)
  useEffect(() => {
    if (!open || openTarget === undefined || openTarget.seq === appliedRequestSeq.current) return
    appliedRequestSeq.current = openTarget.seq
    const targetMonth = openTarget.month ?? month
    if (openTarget.month !== undefined) {
      setMonth(openTarget.month)
      setPickedDay(undefined)
    }
    setPendingEventKey(openTarget.eventKey === undefined ? undefined : { month: targetMonth, eventKey: openTarget.eventKey })
  }, [open, openTarget, month])

  /**
   * 那条事件的详情，等**它那个月的读数回来**再开：抽屉走同一次按月读，抢在读数前面找必然找不到。
   * - 找得到：开详情，并把右列落到它那一天；
   * - 这个月读成功却没有它：只停在月上——不编一条，也不假装详情打开了；
   * - 读不到（`unavailable`）：不动。那是「不知道有没有」，不是「没有」。
   */
  useEffect(() => {
    if (pendingEventKey === undefined) return
    if (releases.state !== 'ready' || releases.readMonth !== pendingEventKey.month) return
    setPendingEventKey(undefined)
    const target = releases.events.find((event) => event.eventKey === pendingEventKey.eventKey)
    if (target === undefined) return
    setDetailEvent(target)
    setPickedDay({ month: pendingEventKey.month, day: calendarDisplayDate(target.scheduledAt, timeZone) })
  }, [pendingEventKey, releases.state, releases.readMonth, releases.events, timeZone])

  return {
    month,
    releases,
    selectedDay,
    dayWasPicked: pickedDay !== undefined,
    dayEvents,
    detailEvent,
    changeMonth: (next) => { setMonth(next); setPickedDay(undefined) },
    selectDay: (day) => setPickedDay({ month, day }),
    selectEvent: setDetailEvent,
    clear: () => { setDetailEvent(undefined); setPendingEventKey(undefined) }
  }
}
