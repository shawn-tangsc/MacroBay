import type { ReactElement } from 'react'

import { LoadingState } from '@platform/ui/components/loading'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'

import type { MarketCalendarEvent, MarketCalendarSource } from '../../../../contracts/macro/marketCalendarQueryContracts'
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
export function CalendarMonthBoard({ month, asOf, today, statusNow, onOpenDay, onSelectItem, selectedEventKey, state, text, events, marketEvents, marketSources, coverage }: {
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
}): ReactElement {
  const status = state.state === 'loading' ? text.status.loading : state.state === 'unavailable' ? text.failures[state.failureCode] : undefined
  if (state.state !== 'available' && !marketEvents.length) return <CalendarState month={month} text={status!} loading={state.state === 'loading'} />
  const projection = state.state === 'available' ? state.projection : createEconomicCalendarProjection({ month, asOf, events: [] })
  return <div className="mi-calendar-month-scroll">{status ? (state.state === 'loading' ? <LoadingState layout="inline" size="sm" label={status} /> : <p role="status">{status}</p>) : null}<CalendarMonth statusNow={statusNow} today={today} events={events} marketEvents={marketEvents} marketSources={marketSources} onSelectItem={onSelectItem} coverage={coverage} month={month} projection={projection} selectedEventKey={selectedEventKey} onOpenDay={onOpenDay} text={text} /></div>
}

function CalendarState({ month, text, loading }: { month: string; text: string; loading: boolean }): ReactElement {
  return <section className="mi-economic-calendar__month" aria-live="polite" data-month-key={month}>
    {loading ? <LoadingState label={text} minHeight={220} /> : <p className="mi-economic-calendar__more">{text}</p>}
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
