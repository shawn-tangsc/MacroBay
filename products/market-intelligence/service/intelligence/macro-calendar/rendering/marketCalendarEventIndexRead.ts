import type { DatabaseSync } from 'node:sqlite'

import type { MarketCalendarEvent } from '../../../../contracts/macro/marketCalendarQueryContracts'
import { calendarNamesFor } from '../marketCalendarCodeNames'

/**
 * **仅渲染层**：事件清单（一行一个事件身份，不是一次发布）。
 *
 * 用户 2026-11-16 定的用途：核对「每个事件去哪看官方发布」。所以一行 = 一个 `metric_key`
 * （621 个），期间/最近一次发布/下次发布是**发布环节的聚合列**；发布明细在月历里。
 *
 * 三条判据（Chief 2026-11-16）：
 * 1. **空数组只表示「没有匹配」**，读不到用 `state: 'unavailable'`；两者不许混；
 * 2. `total` 必须等于实际可翻到的行数（分页翻到底的行数之和 = total）；
 * 3. **游标排序带唯一 tiebreaker**：同一日期的事件很多，只按日期排会翻出重复或漏行。
 *    这里用「最近一次发布日 desc + 稳定身份键 asc」，游标就是这两个分量本身。
 *
 * 名字是一对（中英各一组四列）：名表里本来就有，读侧以前只取中文简称，搜索框要按中英过滤
 * 就需要两套都给。没有名表条目的（约 420 个上游原始 ID 数组身份）退回 `source_label`，
 * 并用 `titleIsSourceLabel` 标出来——那是「源原文名」，不是我们起的名字。
 */
export type CalendarEventIndexRow = Readonly<{
  /** 稳定键（身份），分页与渲染都用它，不用行号。 */
  key: string
  countryCode: string
  metricKey: string
  zhFull?: string
  zhShort?: string
  enFull?: string
  enShort?: string
  sourceLabel?: string
  /** 名字位显示的是源原文名（不是名表条目）。 */
  titleIsSourceLabel: boolean
  /** 最近一次已发布那一期的期间（没有已发布的就是空）。 */
  period?: string
  lastRelease?: Readonly<{ date: string; scheduledAt?: string }>
  nextRelease?: Readonly<{ date: string; scheduledAt?: string }>
  importance?: 'high' | 'medium' | 'low'
  eventType: MarketCalendarEvent['eventType'] | 'unknown'
}>

export type CalendarEventIndexRead = Readonly<{
  state: 'available'
  rows: readonly CalendarEventIndexRow[]
  total: number
  nextCursor?: string
}> | Readonly<{ state: 'unavailable'; reasonCode: 'query-unavailable' }>

type Aggregate = Readonly<{
  country_code: string
  metric_key: string
  last_date: string | null
  last_at: string | null
  last_period: string | null
  next_date: string | null
  next_at: string | null
  importance: string | null
  source_label: string | null
}>

const eventTypeOf = (metricKey: string): CalendarEventIndexRow['eventType'] => {
  if (!metricKey.startsWith('evt.')) return 'economic-indicator'
  if (/^evt\.(central-bank|monetary-policy)/.test(metricKey)) return 'central-bank-activity'
  return 'financial-event'
}

const cursorOf = (row: CalendarEventIndexRow): string =>
  `${row.lastRelease?.date ?? ''}|${row.key}`

const cursorKey = (cursor: string): readonly [string, string] => {
  const cut = cursor.indexOf('|')
  return cut < 0 ? ['', cursor] : [cursor.slice(0, cut), cursor.slice(cut + 1)]
}

/** 名字优先级：名表四列（中英各一对）→ 源原文名。都没有就不硬编。 */
function namesOf(metricKey: string, sourceLabel: string | null) {
  const names = calendarNamesFor(metricKey)
  const fallback = sourceLabel === null || sourceLabel.trim() === '' ? undefined : sourceLabel.trim()
  return {
    ...(names === undefined ? {} : { ...names }),
    ...(fallback === undefined ? {} : { sourceLabel: fallback }),
    titleIsSourceLabel: names === undefined && fallback !== undefined
  }
}

/** 一处聚合：一个身份一行，取「最近一次已发布」和「下一次未发布」。 */
function aggregates(database: DatabaseSync, today: string): Aggregate[] {
  return database.prepare(`select country_code, metric_key,
      max(case when scheduled_date <= ?1 then scheduled_date end) as last_date,
      min(case when scheduled_date > ?1 then scheduled_date end) as next_date,
      max(importance) as importance, max(source_label) as source_label
    from mi_calendar_events where row_kind = 'release'
    group by country_code, metric_key`).all(today) as unknown as Aggregate[]
}

/** 那两个时刻与期间：按上面的日期回查一次（聚合里带不出「那一行的另一列」）。 */
function detailOf(database: DatabaseSync, countryCode: string, metricKey: string, date: string | null):
  Readonly<{ period?: string; scheduledAt?: string }> {
  if (date === null) return {}
  const row = database.prepare(`select period_key, scheduled_at from mi_calendar_events
    where country_code = ? and metric_key = ? and scheduled_date = ? and row_kind = 'release'
    order by period_key desc limit 1`).get(countryCode, metricKey, date) as
    { period_key: string; scheduled_at: string | null } | undefined
  return row === undefined ? {} : {
    period: row.period_key,
    ...(row.scheduled_at === null ? {} : { scheduledAt: row.scheduled_at })
  }
}

/**
 * 读一页事件清单。
 *
 * - `nameQuery`：空格拆词，**每个词都要在某一列命中**；命中列集合＝zhFull/zhShort/enFull/enShort
 *   ＋`sourceLabel`（源原文名）。英文大小写折叠。**不拼接字段**（拼接会造出跨字段假命中）。
 * - `countryCode`：独立筛选（不与名字混，混了 `US` 会命中所有美国事件，看起来像名字匹配其实是身份匹配）。
 * - `cursor`：上一页最后一行的 `cursorOf`；`pageSize` 上限按 200。
 */
export function readCalendarEventIndex(database: DatabaseSync, input: Readonly<{
  today: string
  cursor?: string
  pageSize?: number
  nameQuery?: string
  countryCode?: string
}>): CalendarEventIndexRead {
  try {
    const pageSize = Math.min(Math.max(input.pageSize ?? 50, 1), 200)
    const words = (input.nameQuery ?? '').trim().toLowerCase().split(/\s+/).filter((word) => word !== '')
    const rows: CalendarEventIndexRow[] = []
    for (const aggregate of aggregates(database, input.today)) {
      if (input.countryCode !== undefined && input.countryCode !== '' && aggregate.country_code !== input.countryCode) continue
      const names = namesOf(aggregate.metric_key, aggregate.source_label)
      if (words.length > 0) {
        // 命中列集合 = 名表四列 + 源原文名。**不拼接**（拼接会造出跨字段假命中）。
        const haystack = Object.values(names)
          .filter((value): value is string => typeof value === 'string').map((value) => value.toLowerCase())
        if (!words.every((word) => haystack.some((field) => field.includes(word)))) continue
      }
      const lastDetail = detailOf(database, aggregate.country_code, aggregate.metric_key, aggregate.last_date)
      const nextDetail = detailOf(database, aggregate.country_code, aggregate.metric_key, aggregate.next_date)
      rows.push(Object.freeze({
        key: `${aggregate.country_code}|${aggregate.metric_key}|${lastDetail.period ?? ''}`,
        countryCode: aggregate.country_code,
        metricKey: aggregate.metric_key,
        ...names,
        ...(lastDetail.period === undefined ? {} : { period: lastDetail.period }),
        ...(aggregate.last_date === null ? {} : {
          lastRelease: { date: aggregate.last_date, ...(lastDetail.scheduledAt === undefined ? {} : { scheduledAt: lastDetail.scheduledAt }) }
        }),
        ...(aggregate.next_date === null ? {} : {
          nextRelease: { date: aggregate.next_date, ...(nextDetail.scheduledAt === undefined ? {} : { scheduledAt: nextDetail.scheduledAt }) }
        }),
        ...(aggregate.importance === null ? {} : { importance: aggregate.importance as 'high' | 'medium' | 'low' }),
        eventType: eventTypeOf(aggregate.metric_key)
      }))
    }
    // 排序：最近一次发布日 **倒序**，同日用稳定键升序——**tiebreaker 必须是唯一的**，
    // 否则同一天的那批事件在翻页边界上会重复出现或漏掉（真数据里同日几十条很常见）。
    rows.sort((left, right) => {
      const leftDate = left.lastRelease?.date ?? ''
      const rightDate = right.lastRelease?.date ?? ''
      if (leftDate !== rightDate) return leftDate < rightDate ? 1 : -1
      return left.key < right.key ? -1 : left.key > right.key ? 1 : 0
    })
    const start = input.cursor === undefined ? 0 : rows.findIndex((row) => cursorOf(row) === input.cursor) + 1
    const page = rows.slice(start, start + pageSize)
    const hasMore = start + page.length < rows.length
    return Object.freeze({
      state: 'available' as const,
      rows: Object.freeze(page),
      total: rows.length,
      ...(hasMore && page.length > 0 ? { nextCursor: cursorOf(page[page.length - 1]!) } : {})
    })
  } catch {
    return { state: 'unavailable', reasonCode: 'query-unavailable' }
  }
}

/** 供 IPC 层与用例复用：游标 → 两个分量（避免各写一份解析）。 */
export const calendarEventIndexCursorParts = cursorKey
