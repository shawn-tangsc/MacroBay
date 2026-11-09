import { Landmark, Newspaper, TrendingUp, type LucideIcon } from 'lucide-react'
import { Tooltip } from '@platform/ui/components/tooltip'
import type { MarketCalendarEvent, MarketCalendarSource } from '../../../../contracts/macro/marketCalendarQueryContracts'
import { useProductTextKey } from '../../../shared/i18n/productTextKey'
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
  // `dataText` still takes the resolver: the type keeps both branches the same shape, and a caller
  // that switches this hint to a key later must not also have to find a new resolver.
  const resolveText = useProductTextKey()
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
  // The description is runtime data (time, title, status), not a sentence from the text table, so it
  // goes through `dataText`. The hint is the same line on hover and on focus; the accessible name is
  // that same line — it used to repeat the time, because the template added it a second time.
  //
  // 整行即动作，平台组件表达不了：`Choice` 会把一条已发布的事件变成「可选中项」（语义错），换平台
  // 按钮又会把行内的时间、种类字形、标题一起包成一颗文字按钮——那正是用户否过的样子。所以这里保留
  // 原生 `<button>`：`aria-label` 给名字（同一句也做悬停提示）、原生按钮自带键盘可达、
  // `.mi-economic-calendar__event:hover` 给悬停反馈。用户 2026-11-09 判决：保留，别当漏换的裸按钮。
  return <Tooltip dataText={description} resolveText={resolveText}>
    <button className="mi-economic-calendar__event" data-event-key={item.source === 'official' ? item.event.eventKey : undefined}
      data-market-event={item.source === 'market' ? item.event.eventKey : undefined} data-calendar-row data-importance={important ? 'high' : item.source === 'market' ? item.event.importance : undefined}
      data-event-status={status} type="button" aria-label={description} aria-pressed={selected} onClick={() => onSelect(item)}>
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
