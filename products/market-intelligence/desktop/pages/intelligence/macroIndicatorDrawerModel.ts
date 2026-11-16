import { calendarDisplayTime } from '../../features/macro/economic-calendar/economicCalendarDayModel'
import { calendarDisplayDate } from '../../features/macro/economic-calendar/economicCalendarDayModel'
import { filterVisibleByTier } from '../../../service/intelligence/macro-calendar/marketCalendarTierVisibility'
import { tierOfMetricKey } from '../../../service/intelligence/macro-calendar/marketCalendarReleaseGroups'
import { matchedRelevantConcept, POLICY_PATH_EVENT_RELEVANT_SERIES_IDS } from '../../../contracts/policyPath'
import type { MarketCalendarEvent } from '../../../contracts/macro/marketCalendarQueryContracts'
import type { CalendarDayItem } from '../../features/macro/economic-calendar/economicCalendarDayModel'

/**
 * 「打开日历抽屉，并落到这一个位置」。
 *
 * `seq` 回答的是「又点了一次」——同一个目标再点一次也要生效（读者可能已经翻走了）。
 * 而定位**只在序号变化时落一次**：页面为别的原因重渲染，不许把翻过月份的读者拽回来。
 * `month` 是 `YYYY-MM`（显示时区），入口都从自己正在看的那一格拿到它；
 * `eventKey` 只有「在日历中打开某一件事」才带。
 */
export type CalendarDrawerRequest = Readonly<{
  seq: number
  month?: string
  eventKey?: string
}>

/**
 * 下一次发布：在**同一次按月读**的结果里按身份找「现在之后」最近的一条。
 *
 * 找不到就返回 `undefined`，调用方**不画这一格**——写「未提供」会让人以为今天该有一次发布。
 * 日期用与日历一致的显示时区算，再取 `MM-DD`（跨年时补上年，避免把 1 月写成去年）。
 */
export function nextReleaseOf(events: readonly Readonly<{ scheduledAt: string; measureKeys?: readonly string[] }>[], keys: readonly string[], nowInstant: string, timeZone: string): string | undefined {
  const nowMs = Date.parse(nowInstant)
  const next = events
    .filter((event) => Date.parse(event.scheduledAt) > nowMs)
    .filter((event) => (event.measureKeys ?? []).some((key) => keys.includes(key)))
    .sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt))[0]
  if (next === undefined) return undefined
  const day = calendarDisplayDate(next.scheduledAt, timeZone)
  return day.slice(0, 4) === calendarDisplayDate(nowInstant, timeZone).slice(0, 4) ? day.slice(5) : day
}

/**
 * 选中哪一天：今天有事件就是今天；否则取**离今天最近**的那一个有事件的日子（同日距离取靠后的）。
 * 这个月一条事件都没有时仍选今天（今天不在本月就取 1 号），右列给空态，不是给一个空标题。
 */
export function defaultDayFor(month: string, eventDays: ReadonlySet<string>, today: string): string {
  if (eventDays.has(today) && today.startsWith(`${month}-`)) return today
  const todayMs = Date.parse(`${today}T00:00:00.000Z`)
  let best: string | undefined
  let bestGap = Number.POSITIVE_INFINITY
  for (const day of [...eventDays].filter((value) => value.startsWith(`${month}-`)).sort()) {
    const gap = Math.abs(Date.parse(`${day}T00:00:00.000Z`) - todayMs)
    if (gap <= bestGap) { best = day; bestGap = gap }
  }
  if (best !== undefined) return best
  return today.startsWith(`${month}-`) ? today : `${month}-01`
}

/**
 * 右列两层结构（用户 2026-11-15 定，三次改口后收敛）：
 *
 * 1. **第一层按事件类型**：经济指标 → 财经事件 → 央行活动，三组都在，不许并成一个「其他指标」；
 * 2. **第二层只对经济指标**：组内再按分级分（一级/二级/未分级），标题带条数；
 * 3. 央行活动、财经事件各自一组，不再拆分级——它们本来没有指标码。
 *
 * 分级只决定格子里露不露名字、进不进数字（`filterVisibleByTier`），在这里只用来分子组。
 */
export function dayGroups(allDay: readonly MarketCalendarEvent[], date: string, timeZone: string, sequence: string,
  typeTitle: (eventType: MarketCalendarEvent['eventType'], count: number) => string,
  tierTitle: (tier: DayTier, count: number) => string
): readonly Readonly<{ eventType: MarketCalendarEvent['eventType']; title: string; items: readonly CalendarDayItem[]
  subgroups?: readonly Readonly<{ title: string; items: readonly CalendarDayItem[] }>[] }>[] {
  // 当天事件**全部列出**（用户 2026-11-14）；同刻同名多条按序号标「第 i/N 条」。
  const totals = new Map<string, number>()
  for (const event of allDay) {
    totals.set(`${event.scheduledAt}|${event.title}`, (totals.get(`${event.scheduledAt}|${event.title}`) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  const toItem = (event: MarketCalendarEvent): CalendarDayItem => {
    const identity = `${event.scheduledAt}|${event.title}`
    const total = totals.get(identity) ?? 1
    const index = (seen.get(identity) ?? 0) + 1
    seen.set(identity, index)
    return {
      key: event.eventKey, date, time: calendarDisplayTime(event.scheduledAt, timeZone), source: 'market',
      event: total > 1
        ? { ...event, title: sequence.replace('{name}', event.title).replace('{index}', String(index)).replace('{total}', String(total)) }
        : event
    }
  }
  const byTime = (left: MarketCalendarEvent, right: MarketCalendarEvent): number =>
    Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt)
  return (['economic-indicator', 'financial-event', 'central-bank-activity'] as const)
    .map(eventType => {
      const bucket = allDay.filter(event => event.eventType === eventType).sort(byTime)
      if (eventType !== 'economic-indicator') {
        return { eventType, title: typeTitle(eventType, bucket.length), items: bucket.map(toItem) }
      }
      // 只有指标组有分级：讲话/商品报告/articles 没有指标码，在各自的类型组里不拆。
      const subgroups = DayTierOrder
        .map(tier => ({ tier, events: bucket.filter(event => dayTierOf(event) === tier) }))
        .filter(group => group.events.length > 0)
        .map(group => ({ title: tierTitle(group.tier, group.events.length), items: group.events.map(toItem) }))
      return { eventType, title: typeTitle(eventType, bucket.length), items: [], subgroups }
    })
    .filter(group => group.items.length > 0 || (group.subgroups?.length ?? 0) > 0)
}

/** 右列分组用的分级：1/2/3 来自指标码，其余（讲话、源内身份行）归 `other`。 */
export type DayTier = '1' | '2' | '3' | 'other'

/** 子组顺序就是分级顺序：一级 → 二级 → 三级 → 未分级。今天表里没有三级码，那一组自然不出现。 */
const DayTierOrder = ['1', '2', '3', 'other'] as const

export function dayTierOf(event: MarketCalendarEvent): DayTier {
  const tier = tierOfMetricKey(event.eventNameKey ?? event.measureKeys?.[0] ?? '')
  return tier === 1 ? '1' : tier === 2 ? '2' : tier === 3 ? '3' : 'other'
}

/**
 * 右列的三层（产品经理口径，Chief 2026-11-13 裁决）：判据只有身份，**不看 importance、不看名字**。
 *
 * - 核心层：四个必标 `metric_key` 的发布 + FOMC 决议/纪要——和曲线标注完全同一把尺子；
 * - 次要层：其余经济指标，折成一行「其他 N 条」，就地展开；
 * - 不进层：央行讲话/报告/资产负债表、商品库存、财经事件——不进列表，也不进「其他」的计数。
 */
export type DayLayers = Readonly<{ core: readonly MarketCalendarEvent[]; other: readonly MarketCalendarEvent[] }>

export function splitDayLayers(events: readonly MarketCalendarEvent[]): DayLayers {
  const core: MarketCalendarEvent[] = []
  const other: MarketCalendarEvent[] = []
  for (const event of events) {
    if (event.eventType !== 'economic-indicator') continue
    const relevant = matchedRelevantConcept({
      at: event.scheduledAt, label: event.title,
      ...(event.eventNameKey === undefined ? {} : { eventNameKey: event.eventNameKey }),
      ...(event.measureKeys === undefined ? {} : { measureKeys: event.measureKeys }),
      ...(event.seriesId === undefined ? {} : { seriesId: event.seriesId })
    }) !== undefined
      || (event.seriesId !== undefined && (POLICY_PATH_EVENT_RELEVANT_SERIES_IDS as readonly string[]).includes(event.seriesId))
    ;(relevant ? core : other).push(event)
  }
  return { core: core.slice(0, 8), other }
}

