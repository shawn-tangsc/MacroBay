import type { ReactElement } from 'react'

import { LoadingState } from '@platform/ui/components/loading'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'

import type { MarketCalendarEvent, MarketCalendarSource } from '../../../../contracts/macro/marketCalendarQueryContracts'
import { StateView } from '@platform/ui/components/state'
import { CalendarEmptyMonthState } from './CalendarEmptyMonthState'
import { CalendarEventRow } from './CalendarEventRow'
import { unifiedCalendarDay, type CalendarDayCoverage, type CalendarDayItem } from './economicCalendarDayModel'
import { createEconomicCalendarProjection, type EconomicCalendarEventView, type EconomicCalendarProjection } from './economicCalendarModel'
import type { EconomicCalendarText } from './economicCalendarText'
import type { EconomicCalendarMonthState } from './useEconomicCalendarMonthWindow'

/**
 * A month with no events is not a failed read: it is a reading, and it carries no action (nothing the
 * reader could press would produce events). The count is the "empty month" boundary for the board.
 */
const economicCalendarEmptyStateActionPolicy = { emptyEventCount: 0 } as const

/**
 * The board half of the page: the month grid, plus the shell that shows why the grid is not there.
 *
 * It was inside `EconomicCalendar.tsx`, which is the page's orchestration (queries, selection,
 * selection identity, the detail panel) and had grown past its size gate. Nothing here reads page
 * state: every value arrives as a prop, so the grid can be reasoned about — and tested — without the
 * page's effects.
 */
export function CalendarMonthBoard({ month, asOf, today, statusNow, onOpenDay, onSelectItem, selectedEventKey, state, text, events, marketEvents, marketSources, coverage, officialUnavailable }: {
  statusNow: string
  today: string
  asOf: string
  events: readonly EconomicCalendarEventView[]
  marketEvents: readonly MarketCalendarEvent[]
  marketSources: readonly MarketCalendarSource[]
  onSelectItem: (item: CalendarDayItem) => void
  coverage: CalendarDayCoverage
  month: string
  onOpenDay: (day: string) => void
  selectedEventKey: string | undefined
  state: EconomicCalendarMonthState
  text: EconomicCalendarText
  /** 官方源停用时那一句；有它就按「拿不到」画，而不是按「没有」。 */
  officialUnavailable?: string
}): ReactElement {
  let status: string | undefined = state.state === 'loading' ? text.status.loading : state.state === 'unavailable' ? text.failures[state.failureCode] : undefined
  /**
   * 「没有」与「拿不到」必须分得开（Chief 2026-11-08）：官方那条腿读不到时，
   * - 市场侧也没有行 → 错误态，**不给动作**（再试必失败、去设置也改不了 403）；
   * - 市场侧有行 → 正常列出来，另加一条 muted 说明；摆空态会把「还有数据」说成「什么都没有」。
   */
  const surface = monthSurface({ officialUnavailable: officialUnavailable !== undefined, officialCount: events.length, marketCount: marketEvents.length })
  if (surface === 'official-unavailable') return <CalendarState month={month} text={officialUnavailable!} loading={false} unavailable />
  /**
   * 说明行是**常驻注解**，不是状态变更：用 `role="note"`，别用活区。
   * 且两行说同一件事时只留一行——`note` 在、状态又是 `unavailable`（BLS 停用 + 当月查询也失败 + 市场侧有行，
   * 这条组合可达）时，`unavailable` 那句与注解讲的是同一件事；`loading` 那句要说「正在读」，保留。
   */
  const { note, status: statusLine } = monthStatusLines({
    note: surface === 'note' ? officialUnavailable : undefined,
    state: state.state,
    status
  })
  if (state.state !== 'available' && !marketEvents.length) return <CalendarState month={month} text={status!} loading={state.state === 'loading'} />
  const projection = state.state === 'available' ? state.projection : createEconomicCalendarProjection({ month, asOf, events: [] })
  return <div className="mi-calendar-month-scroll">{note ? <p className="mi-economic-calendar__comparison-rule" role="note">{note}</p> : null}{statusLine ? (state.state === 'loading' ? <LoadingState layout="inline" size="sm" label={statusLine} /> : <p role="status">{statusLine}</p>) : null}<CalendarMonth statusNow={statusNow} today={today} events={events} marketEvents={marketEvents} marketSources={marketSources} onSelectItem={onSelectItem} coverage={coverage} month={month} projection={projection} selectedEventKey={selectedEventKey} onOpenDay={onOpenDay} text={text} /></div>
}

/**
 * 这一个月要显示的说明/状态行——两条会不会重复，只在这里判一次。
 *
 * - 说明行（官方源拿不到）与 `unavailable` 那句讲的是同一件事（那条组合可达：停用 + 当月查询失败 + 市场有行），
 *   所以说明在时压掉 `unavailable`，只留一行；
 * - `loading` 那句必须留：它说的是「正在读」，和「拿不到」不是同一句。
 */
export function monthStatusLines(input: Readonly<{
  note?: string
  state: 'loading' | 'unavailable' | 'available'
  status?: string
}>): Readonly<{ note?: string; status?: string }> {
  const suppressStatus = input.note !== undefined && input.state === 'unavailable'
  return {
    ...(input.note === undefined ? {} : { note: input.note }),
    ...(input.status === undefined || suppressStatus ? {} : { status: input.status })
  }
}

/**
 * 这个月该怎么画，一句话判完——三态都能单独测，不用渲染整块板子。
 *
 * 判据（Chief 2026-11-08）：只有「两个来源都读到了」才允许说「本月没有」；官方那条腿读不到时，
 * 空必须说成「拿不到」。官方不可用且市场侧有行时，**不许摆空态**——那会把「还有数据」说成「什么都没有」。
 */
export function monthSurface(input: Readonly<{ officialUnavailable: boolean; officialCount: number; marketCount: number }>): 'board' | 'note' | 'official-unavailable' {
  if (!input.officialUnavailable) return 'board'
  if (input.officialCount === 0 && input.marketCount === 0) return 'official-unavailable'
  return input.marketCount > 0 ? 'note' : 'board'
}

function CalendarState({ month, text, loading, unavailable = false }: { month: string; text: string; loading: boolean; unavailable?: boolean }): ReactElement {
  return <section className="mi-economic-calendar__month" aria-live="polite" data-month-key={month}>
    {loading
      ? <LoadingState label={text} minHeight={220} />
      // 拿不到：错误态 + 产品那句话，**不给动作按钮**——这里没有能让它成功的按钮。
      : unavailable
        ? <StateView className="mi-economic-calendar__official-unavailable" productReason={{ key: 'mi.calendar.official-unavailable', resolve: () => text }}
            reasonCode="capability-not-wired" size="lg" state="disabled" />
        : <p className="mi-economic-calendar__more">{text}</p>}
  </section>
}

function CalendarMonth({ month, today, statusNow, projection, events, selectedEventKey, onOpenDay, onSelectItem, text, marketEvents, marketSources, coverage }: {
  statusNow: string
  today: string
  events: readonly EconomicCalendarEventView[]
  marketEvents: readonly MarketCalendarEvent[]
  marketSources: readonly MarketCalendarSource[]
  onSelectItem: (item: CalendarDayItem) => void
  coverage: CalendarDayCoverage
  month: string
  projection: EconomicCalendarProjection
  selectedEventKey: string | undefined
  onOpenDay: (day: string) => void
  text: EconomicCalendarText
}): ReactElement {
  const timeZone = useShellTimeZone()
  const linkedMarketKeys = new Set(marketEvents.filter(event => event.officialLink).map(event => event.eventKey))
  return <section className="mi-economic-calendar__month" aria-label={projection.month} data-month-key={month}>
    <div className="mi-economic-calendar__weekdays">{text.weekdays.map((day) => <span key={day}>{day}</span>)}</div>
    <div className="mi-economic-calendar__grid">
      {projection.days.map((day) => {
        const unified = unifiedCalendarDay(day.dateKey, events, marketEvents, coverage, timeZone, linkedMarketKeys)
        return <article className="mi-economic-calendar__day" data-date={day.dateKey} data-month={day.month} key={day.dateKey}>
          <span className="mi-economic-calendar__date" aria-current={day.dateKey === today ? 'date' : undefined}>{day.day}</span>
          <div className="mi-economic-calendar__events">
            {unified.visible.map(item => <CalendarEventRow key={item.key} item={item} marketSources={marketSources} text={text} statusNow={statusNow} selected={item.event.eventKey === selectedEventKey} onSelect={onSelectItem} />)}
            {unified.coverage !== 'complete' || unified.remaining ? <button data-calendar-more className="mi-economic-calendar__more mi-economic-calendar__more-button" onClick={() => onOpenDay(day.dateKey)} type="button">{unified.coverage === 'complete' ? text.unifiedDay.more.replace('{count}', String(unified.remaining)) : text.unifiedDay[unified.coverage]}</button> : null}
          </div>
        </article>
      })}
    </div>
    {events.length === economicCalendarEmptyStateActionPolicy.emptyEventCount && !marketEvents.length ? <CalendarEmptyMonthState text={text} /> : null}
  </section>
}
