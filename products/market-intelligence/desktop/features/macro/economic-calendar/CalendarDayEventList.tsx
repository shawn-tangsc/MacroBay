import type { MarketCalendarSource } from '../../../../contracts/macro/marketCalendarQueryContracts'
import { CalendarEventRow } from './CalendarEventRow'
import type { CalendarDayCoverage, CalendarDayItem } from './economicCalendarDayModel'
import type { EconomicCalendarText } from './economicCalendarText'

/**
 * The day list under the month grid: one section per event type, sticky headings, one row per event.
 *
 * It was inline JSX inside `EconomicCalendar.tsx`. The 关键指标 drawer draws the same list, so the
 * structure moved here instead of being written twice — two copies drift the first time one of them
 * changes a heading, a truncation rule or the sticky top.
 *
 * It is presentational: every value arrives as a prop, and the caller keeps the selection state.
 */
export function CalendarDayEventList({ label, title, summary, groups, emptyText, listRef, marketSources, text, statusNow, selectedEventKey, selectedMarketKey, onSelect }: Readonly<{
  label: string
  /** The page scrolls this list to the top when the selected day changes; the drawer passes nothing. */
  listRef?: React.RefObject<HTMLElement | null>
  /** Already filled with the day; the caller owns the sentence. */
  title: string
  summary: string
  groups: readonly Readonly<{ eventType: keyof EconomicCalendarText['market']['kinds']; items: readonly CalendarDayItem[] }>[]
  /** Shown only when the sources answered and the answer is zero; omitted means no sentence. */
  emptyText?: string
  marketSources: readonly MarketCalendarSource[]
  text: EconomicCalendarText
  statusNow: string
  selectedEventKey: string | undefined
  selectedMarketKey: string | undefined
  /** `undefined` = 这一列没有可去的地方：行渲染成非交互形态，不画点头没反应的按钮。 */
  onSelect?: (item: CalendarDayItem) => void
}>): React.ReactElement {
  return <section aria-label={label} className="mi-calendar-day-list" data-calendar-day-list ref={listRef}>
    <h2>{title}</h2>
    <p data-day-summary>{summary}</p>
    <div role="list">{groups.map(group => <section data-calendar-group={group.eventType} key={group.eventType}>
      <h3>{text.unifiedDay.groupCount.replace('{type}', text.market.kinds[group.eventType]).replace('{count}', String(group.items.length))}</h3>
      {group.items.map(item => <div role="listitem" key={item.key}><CalendarEventRow item={item} marketSources={marketSources} text={text} statusNow={statusNow} selected={item.source === 'market' ? item.event.eventKey === selectedMarketKey : item.event.eventKey === selectedEventKey} onSelect={onSelect} /></div>)}
    </section>)}</div>
    {/* A quiet day is a reading, not a missing block: the sources answered and the answer is
        zero. It carries no action because nothing the reader can press would produce events, and a
        button that does nothing is worse than none. The sentence stays visible so a blank area
        cannot be mistaken for "not loaded yet". */}
    {emptyText === undefined ? null : <p>{emptyText}</p>}
  </section>
}

/** The one sentence above the groups: a partial read says so instead of claiming a total. */
export function calendarDaySummary(coverage: CalendarDayCoverage, count: number, text: EconomicCalendarText): string {
  return `${coverage === 'complete' ? text.unifiedDay.total.replace('{count}', String(count)) : text.unifiedDay[coverage]} · ${text.unifiedDay.grouped}`
}
