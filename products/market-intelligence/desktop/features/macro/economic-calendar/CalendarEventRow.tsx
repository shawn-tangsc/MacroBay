import { Tooltip } from 'antd'
import { Landmark, Newspaper, TrendingUp, type LucideIcon } from 'lucide-react'
import type { MarketCalendarEvent, MarketCalendarSource } from '../../../../contracts/macro/marketCalendarQueryContracts'
import type { EconomicCalendarText } from './economicCalendarText'
import { calendarItemType, isHighImportanceCalendarItem, type CalendarDayItem } from './economicCalendarDayModel'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { calendarEventStatus } from './calendarEventStatusModel'

/**
 * One glyph per kind, so a cell that mixes kinds says which row is which at a glance. The day list
 * groups by kind under headings instead, but its rows are the same rows.
 */
const calendarKindGlyphs: Record<MarketCalendarEvent['eventType'], LucideIcon> = {
  'economic-indicator': TrendingUp,
  'financial-event': Newspaper,
  'central-bank-activity': Landmark
}

export function CalendarEventRow({ item, text, statusNow, onSelect, marketSources = [], selected = false }: {
  item: CalendarDayItem; text: EconomicCalendarText; statusNow: string; onSelect: (item: CalendarDayItem) => void
  /** Source-level state for this page. Only the market route can carry a storage-limit verdict. */
  marketSources?: readonly MarketCalendarSource[]; selected?: boolean
}) {
  const title = item.source === 'market' ? item.event.title : text.events[item.event.labelKey]
  const time = item.time ?? text.unifiedDay.timePending
  const attempt = item.source === 'market'
    ? marketSources.find(source => source.eventType === item.event.eventType)?.latestAttempt
    : undefined
  const status = calendarEventStatus(item, statusNow, useShellTimeZone(), attempt)
  // The 0xRouter route carries the country; the official route is US-only and says so in its own
  // copy, so a country chip there would be noise. Read straight from the provider, which localises
  // the name with the same request (a code like `US` would be a machine token to the reader).
  const country = item.source === 'market' ? item.event.countryName : undefined
  const kind = calendarItemType(item)
  const KindGlyph = calendarKindGlyphs[kind]
  const important = isHighImportanceCalendarItem(item)
  // The kind and the importance ride in the description so the marks have names: the accessible label
  // and the hover text both say them, rather than leaving the reader to decode two glyphs.
  const importanceNote = important ? ` · ${text.details.importance} ${text.importance.high}` : ''
  const description = `${time} ${text.market.kinds[kind]} ${country ? `${country} ` : ''}${title} · ${text.eventStatus[status]}${importanceNote}`
  return <Tooltip title={description} trigger={['hover', 'focus']}>
    <button className="mi-economic-calendar__event" data-event-key={item.source === 'official' ? item.event.eventKey : undefined}
      data-market-event={item.source === 'market' ? item.event.eventKey : undefined} data-calendar-row data-importance={important ? 'high' : item.source === 'market' ? item.event.importance : undefined}
      data-event-status={status} type="button" aria-label={`${time} ${description}`} aria-pressed={selected} onClick={() => onSelect(item)}>
      <span className="mi-economic-calendar__event-time">{time}</span>
      {/* The marks sit inside the title, not beside it: a third grid child collapsed the title to an
          ellipsis once already. The kind glyph leads the run so it lines up down the column, and the
          importance dot follows it directly ahead of the name. */}
      <span className="mi-economic-calendar__event-title">
        <span aria-hidden="true" className="mi-economic-calendar__event-kind" data-event-kind={kind}><KindGlyph size={11} /></span>
        {important ? <span aria-hidden="true" className="mi-economic-calendar__event-marker" data-importance-marker="high" /> : null}
        {country ? <span className="mi-economic-calendar__event-country" data-event-country>{country}</span> : null}{title}
      </span>
    </button>
  </Tooltip>
}
