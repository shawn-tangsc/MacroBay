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
 * 右列**一层**分组（用户 2026-11-19：两层嵌套看不出重点）。
 *
 * 组头就是重点：
 * 1. `一级指标`（置顶）、2. `二级指标`；
 * 3. `其余 N 条`：三级、未分级，以及央行活动/金融事件（它们没有分级）——**默认折叠**，点开再看。
 *
 * 为什么事件也进「其余」：分级与重要性两套口径混在同一屏会变成第三套分类；
 * 用户要的是「重点一眼看到」，不是把每种类型都排一次序。事件在「接下来要看的」里按高重要性单独列。
 */
export type DayGroup = Readonly<{
  /** 组键（同时也是 `data-calendar-group` 的值）：`tier-1` / `tier-2` / `high-events` / `rest`。 */
  key: 'tier-1' | 'tier-2' | 'high-events' | 'rest'
  title: string
  items: readonly CalendarDayItem[]
  /** 「其余」默认收起：一屏先看到重点。 */
  collapsedByDefault?: boolean
}>

export function dayGroups(allDay: readonly MarketCalendarEvent[], date: string, timeZone: string, sequence: string,
  restTitle: (count: number) => string,
  tierTitle: (tier: DayTier, count: number) => string,
  highEventTitle: (count: number) => string = (count) => String(count)
): readonly DayGroup[] {
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
  const sorted = [...allDay].sort(byTime)
  /**
   * 分档只看**指标码的分级**；事件行（央行活动、金融事件）没有码，一律进「其余」。
   * 三级与「未分级」合并成同一组：三级今天 0 个，分开一组只会多一个空标题。
   */
  const first = sorted.filter(event => event.eventType === 'economic-indicator' && dayTierOf(event) === '1')
  const second = sorted.filter(event => event.eventType === 'economic-indicator' && dayTierOf(event) === '2')
  /**
   * **高重要性 = 所有来源标了 `high` 的行，不论类别**（用户 2026-11-19 两次纠正）。
   *
   * 第一版只收央行活动与金融事件，结果当天 5 条高重要性经济指标 + 9 条没有 `event_type` 的行
   * 全被扔进「其余」——用户看到的就是「那么多高重要性的还是收起来了」。
   * 与一二级重叠时**只出现一次**（优先级：一级 > 二级 > 高重要性 > 其余），所以这里要先排除前两组。
   */
  const highEvents = sorted.filter(event => !first.includes(event) && !second.includes(event)
    && event.importance === 'high')
  const rest = sorted.filter(event => !first.includes(event) && !second.includes(event)
    && !highEvents.includes(event))
  const groups: DayGroup[] = []
  if (first.length > 0) groups.push({ key: 'tier-1', title: tierTitle('1', first.length), items: first.map(toItem) })
  if (second.length > 0) groups.push({ key: 'tier-2', title: tierTitle('2', second.length), items: second.map(toItem) })
  if (highEvents.length > 0) {
    groups.push({ key: 'high-events', title: highEventTitle(highEvents.length), items: highEvents.map(toItem) })
  }
  if (rest.length > 0) {
    groups.push({ key: 'rest', title: restTitle(rest.length), items: rest.map(toItem), collapsedByDefault: true })
  }
  return groups
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
 * - 不进层：央行讲话/报告/资产负债表、商品库存、金融事件——不进列表，也不进「其他」的计数。
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

