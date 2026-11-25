import { decisionEventMetricKeyForTitleKey, filterVisibleByTier, tierVisibilityPolicy }
  from '../../../../service/intelligence/macro-calendar/marketCalendarTierVisibility'
import { getMacroCalendarReleaseValueMapping }
  from '../../../../service/intelligence/macro-calendar/macroCalendarReleaseValueMappingPolicy'
import { linkedCalendarImportance }
  from '../../../../service/intelligence/macro-calendar/calendarEventImportance'
import type { MarketCalendarEvent } from '../../../../contracts/macro/marketCalendarQueryContracts'
import type { EconomicCalendarEventView } from './economicCalendarModel'

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
/**
 * 这一行的档。**官方条目若已配上一条市场行（`linkedMarket`）**，档取那一对的那个值——
 * `linkedCalendarImportance` 与简报共用同一处优先级：标准行有码、判据更硬，它的档先；
 * 标准行未分级才回退官方；都没有就是未分级。
 *
 * 判不出重要性**不算**最高一档（与 `projectUpcomingCalendarCard` 同一口径）：官方那条也读记录自己的值。
 * 记录里没有这个字段，就只是「未提供」——行不戴高标记、无障碍名不说「高」。
 */
export function calendarItemImportance(item: CalendarDayItem): MarketCalendarEvent['importance'] {
  if (item.source === 'market') return item.event.importance
  return linkedCalendarImportance(item.linkedMarket?.importance, item.event.importance)
}

export function isHighImportanceCalendarItem(item: CalendarDayItem): boolean {
  return calendarItemImportance(item) === EconomicCalendarUnifiedDayPolicy.visibleImportance
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

/**
 * 这一条对应哪个指标码：没有码的行不参与分级（事件型与源内身份行都属这一类）。
 *
 * 旧路径的官方条目自己不带指标码，但它若吸收了市场行，就随那条市场行——同一次发布，市场行有码。
 * 还没并到市场行时（官方排期先到），按官方发布映射取码：那张表是写标准表时用的同一张，
 * 所以「CPI 这条发布是哪个指标」只有一处定义，不在这里再抄一遍。决议类发布落到事件码上
 * （`evt.fomc`），它凭那张清单同样可以露名字；其余取不到码的官方条目就是未分级，进数字。
 */
function metricKeyOf(item: CalendarDayItem): string {
  if (item.source === 'market') return item.event.eventNameKey ?? ''
  const own = (item.event as { eventNameKey?: string }).eventNameKey
  return own ?? item.linkedMarket?.eventNameKey
    ?? getMacroCalendarReleaseValueMapping(item.event.titleKey)?.metricKey
    ?? decisionEventMetricKeyForTitleKey(item.event.titleKey) ?? ''
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
  // The day list's order — importance first, then the release time — is also the order the cell keeps
  // its rows in, because the list and the cell are one reading of one day. Which kind a row is does
  // not enter into its rank: the glyph says what it is, and ranking by kind inside one importance
  // level is what put a 22:30 indicator above a 16:00 central-bank event of the same weight.
  //
  // **格子里只写一级、二级的名字，最多两条**——判定在 `filterVisibleByTier` 一处实现，其余
  // （未标级的 + 一二级里超出的）全部计入数字。没有例外：事件型（`evt.*`）与源内身份行都没有
  // 分级，所以它们进数字，而不是"没有码就退回旧上限"——那条旧规则会让一整天的名字全摆出来。
  const tiered = filterVisibleByTier(items.map((item) => ({ metricKey: metricKeyOf(item), item })),
    { maximumVisible: tierVisibilityPolicy.maximumVisible })
  const visible = tiered.visible
  const groups = EconomicCalendarUnifiedDayPolicy.eventTypeOrder.map(eventType => ({ eventType,
    items: items.filter(item => calendarItemType(item) === eventType).sort(compareCalendarGroupItems) })).filter(group => group.items.length > 0)
  return { items, visible, groups, coverage,
    hiddenTiered: tiered.hiddenTiered, hiddenUntiered: tiered.hiddenUntiered,
    hiddenTotal: tiered.hiddenTotal,
    remaining: coverage === 'complete' ? Math.max(0, items.length - visible.length) : undefined }
}
