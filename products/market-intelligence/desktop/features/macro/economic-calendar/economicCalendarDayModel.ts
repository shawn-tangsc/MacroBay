import type { MarketCalendarEvent } from '../../../../contracts/macro/marketCalendarQueryContracts'
import { economicCalendarPresentationPolicy, type EconomicCalendarEventView } from './economicCalendarModel'

export type CalendarDayCoverage = 'complete' | 'loading' | 'incomplete'
export type CalendarDayItem = { key: string; date: string; time?: string } & (
  | { source: 'official'; event: EconomicCalendarEventView; linkedMarket?: MarketCalendarEvent }
  | { source: 'market'; event: MarketCalendarEvent }
)

// Design 122 §2.1: display-only ordering; never an identity/link registry. `eventTypeOrder` is how
// the day list groups a day under its headings, and nothing else: the cell ranks by importance and
// release time alone, the same order the list is built in.
export const EconomicCalendarUnifiedDayPolicy = Object.freeze({
  sourceOrder: ['official', 'market'] as const,
  eventTypeOrder: ['economic-indicator', 'financial-event', 'central-bank-activity'] as const,
  visibleImportance: 'high' as const
})

/**
 * 日历的"日"与"时刻"按**窗口级显示时区**切分（`ShellTimeZoneProvider`），不再写死 Asia/Shanghai：
 * 同一个 UTC 瞬时在不同时区属于不同的日历日，分组与显示必须用同一个时区，否则会出现"时间对、日子错"。
 * 格式化器按 zone 缓存（渲染一屏要处理上百个事件，不能每次新建 Intl 实例）。
 */
const formattersByTimeZone = new Map<string, { date: Intl.DateTimeFormat; time: Intl.DateTimeFormat }>()
function formattersFor(timeZone: string): { date: Intl.DateTimeFormat; time: Intl.DateTimeFormat } {
  const cached = formattersByTimeZone.get(timeZone)
  if (cached) return cached
  const created = {
    date: new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }),
    time: new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  }
  formattersByTimeZone.set(timeZone, created)
  return created
}
export function calendarDisplayDate(instant: string, timeZone: string): string {
  const parts = formattersFor(timeZone).date.formatToParts(new Date(instant))
  const part = (type: string) => parts.find(value => value.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
export function calendarDisplayTime(instant: string, timeZone: string): string {
  return formattersFor(timeZone).time.format(new Date(instant))
}
export function isHighImportanceCalendarItem(item: CalendarDayItem): boolean {
  return item.source === 'official' || item.event.importance === EconomicCalendarUnifiedDayPolicy.visibleImportance
}

/**
 * Which day a month stands on.
 *
 * The right column always shows one day, so switching months has to name one: the reader's own day
 * when the target month holds it, and otherwise that month's first day. The alternative — keeping a
 * day from another month — left the column headed by a date the calendar was not showing.
 */
export function calendarDayForMonth(month: string, today: string): string {
  return today.startsWith(`${month}-`) ? today : `${month}-01`
}

export function calendarItemType(item: CalendarDayItem): MarketCalendarEvent['eventType'] {
  return item.source === 'official' ? 'economic-indicator' : item.event.eventType
}

function compareCalendarGroupItems(a: CalendarDayItem, b: CalendarDayItem): number {
  const pending = Number(!a.time) - Number(!b.time)
  const importance = Number(isHighImportanceCalendarItem(b)) - Number(isHighImportanceCalendarItem(a))
  return pending || importance || (a.time ?? '').localeCompare(b.time ?? '') ||
    EconomicCalendarUnifiedDayPolicy.sourceOrder.indexOf(a.source) - EconomicCalendarUnifiedDayPolicy.sourceOrder.indexOf(b.source) || a.key.localeCompare(b.key)
}

export function unifiedCalendarDay(date: string, official: readonly EconomicCalendarEventView[],
  market: readonly MarketCalendarEvent[], coverage: CalendarDayCoverage, timeZone: string, linkedMarketKeys: ReadonlySet<string> = new Set()) {
  const linkedByOfficial = new Map<string, MarketCalendarEvent>()
  for (const event of market) if (event.officialLink) linkedByOfficial.set(event.officialLink.officialEventKey, event)
  const items: CalendarDayItem[] = [
    ...official.map((event): CalendarDayItem => ({ source: 'official', event, linkedMarket: linkedByOfficial.get(event.eventKey), key: `official:${event.eventKey}`,
      date: event.scheduledAt ? calendarDisplayDate(event.scheduledAt, timeZone) : event.scheduledDate,
      ...(event.scheduledAt ? { time: calendarDisplayTime(event.scheduledAt, timeZone) } : {}) })),
    ...market.filter(event => !linkedMarketKeys.has(event.eventKey)).map((event): CalendarDayItem => ({ source: 'market', event, key: `market:${event.eventKey}`,
      date: calendarDisplayDate(event.scheduledAt, timeZone), time: calendarDisplayTime(event.scheduledAt, timeZone) }))
  ].filter(item => item.date === date)
  items.sort((a, b) => {
    const importance = Number(isHighImportanceCalendarItem(b)) - Number(isHighImportanceCalendarItem(a))
    if (importance) return importance
    if (!a.event.scheduledAt && b.event.scheduledAt) return 1
    if (a.event.scheduledAt && !b.event.scheduledAt) return -1
    const time = (a.event.scheduledAt ?? '').localeCompare(b.event.scheduledAt ?? '')
    return time || EconomicCalendarUnifiedDayPolicy.sourceOrder.indexOf(a.source) - EconomicCalendarUnifiedDayPolicy.sourceOrder.indexOf(b.source) || a.key.localeCompare(b.key)
  })
  // The cell is the day's own first six rows — importance first, then the release time — because the
  // list and the cell are one reading of one day. Which kind a row is does not enter into its rank:
  // the glyph says what it is, and ranking by kind inside one importance level is what put a 22:30
  // indicator above a 16:00 central-bank event of the same weight, so the cell read out of order.
  const visible = items.slice(0, economicCalendarPresentationPolicy.dayEventLimit)
  const groups = EconomicCalendarUnifiedDayPolicy.eventTypeOrder.map(eventType => ({ eventType,
    items: items.filter(item => calendarItemType(item) === eventType).sort(compareCalendarGroupItems) })).filter(group => group.items.length > 0)
  return { items, visible, groups, coverage,
    remaining: coverage === 'complete' ? Math.max(0, items.length - visible.length) : undefined }
}
