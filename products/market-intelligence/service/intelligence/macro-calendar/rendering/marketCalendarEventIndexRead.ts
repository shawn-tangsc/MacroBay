import type { DatabaseSync } from 'node:sqlite'

import type { MarketCalendarEvent } from '../../../../contracts/macro/marketCalendarQueryContracts'
import { calendarNamesFor, englishSearchName, namePairFromSourceIdentity, type CalendarNamePair } from '../marketCalendarCodeNames'
import { sourceIdentityDisplayNames } from '../macroCalendarSourceIdentityNames'
import { hierarchyForMetricKey } from '../marketCalendarZeroXRouterSourceMappings'

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
export type CalendarEventIndexRow = Partial<CalendarNamePair> & Readonly<{
  /** 稳定键（身份），分页与渲染都用它，不用行号。 */
  key: string
  countryCode: string
  metricKey: string
  sourceLabel?: string
  /** 名字位显示的是源原文名（不是名表条目）。 */
  titleIsSourceLabel: boolean
  /**
   * **英文名**（用户 2026-11-17）：界面在中文名后面跟一行小字灰字，**不单独占一列**。
   * 取值顺序：名表的英文全名 → 合并时留下的源英文原文名（`source_label_en`）→ `null`。
   * `null` 时只显示中文，**不留「·」或空括号**（半句话比没有更让人困惑）。
   */
  titleEn: string | null
  /**
   * **指标层级**（详情里那一行）：子项给「所属指标」的中文名，母项给出分项中文名（按词表序）。
   * 普通指标没有这一项，界面整行不显示——不画空标签。
   */
  hierarchy?: Readonly<{ kind: 'parent' | 'child'; parentName?: string; childNames?: readonly string[] }>
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
  source_label_en: string | null
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
function namesOf(metricKey: string, sourceLabel: string | null, sourceLabelEn: string | null = null) {
  // 回退链：**码名表 → 源内身份名表 → 源原文名**（用户 2026-11-16 定）。
  const names = calendarNamesFor(metricKey)
  const identity = sourceIdentityDisplayNames[sourceInternalIdOf(metricKey).replace(/^id:/, '')]
  const fallback = sourceLabel === null || sourceLabel.trim() === '' ? undefined : sourceLabel.trim()
  const display = names ?? (identity === undefined ? undefined : namePairFromSourceIdentity(identity.zh, identity.en))
  // **英文原文名单独存一列**（迁移 18 把库里中英两条合并成一行）：名表/身份名表已经给了英文就不覆盖，
  // 它只进搜索命中列，不改变显示名。
  const englishFallback = sourceLabelEn === null || sourceLabelEn.trim() === '' ? undefined : sourceLabelEn.trim()
  const englishName = display?.enFull ?? englishFallback ?? null
  return {
    ...(display === undefined ? {} : { ...display }),
    ...(display === undefined && englishFallback !== undefined ? englishSearchName(englishFallback) : {}),
    ...(fallback === undefined ? {} : { sourceLabel: fallback }),
    // 只有真回退到「源原文名」时才算，源内名表命中是**我们给的名字**，不标。
    titleIsSourceLabel: display === undefined && fallback !== undefined,
    titleEn: englishName
  }
}

/** 一处聚合：一个身份一行，取「最近一次已发布」和「下一次未发布」。 */
function aggregates(database: DatabaseSync, today: string): Aggregate[] {
  return database.prepare(`select country_code, metric_key,
      max(case when scheduled_date <= ?1 then scheduled_date end) as last_date,
      min(case when scheduled_date > ?1 then scheduled_date end) as next_date,
      max(importance) as importance, max(source_label) as source_label,
      max(source_label_en) as source_label_en
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
 * - `nameQuery`：空格拆词，**每个词都要在某一列命中**；命中列集合＝名表那四列（中英全称/简称）
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
      const names = namesOf(aggregate.metric_key, aggregate.source_label, aggregate.source_label_en)
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
        eventType: eventTypeOf(aggregate.metric_key),
        ...(hierarchyForMetricKey(aggregate.metric_key) === undefined
          ? {} : { hierarchy: hierarchyForMetricKey(aggregate.metric_key) })
      }))
    }
    // **同源内身份的中英两条合成一条**（用户 2026-11-16）：源对同一件事发了一条中文名、一条英文名，
    // 两条被当成两个事件收进来，表里一半是重复。身份取「数组 id 的第一段 + 期次月份」，
    // 名字优先中文、英文名保留下来可搜——**只改读取层，不动库**（库里的重复另立一笔）。
    const merged = new Map<string, CalendarEventIndexRow>()
    for (const row of rows) {
      const groupKey = `${row.countryCode}|${sourceInternalIdOf(row.metricKey)}|${(row.period ?? '').slice(0, 7)}`
      const existing = merged.get(groupKey)
      if (existing === undefined) { merged.set(groupKey, { ...row, key: groupKey }); continue }
      merged.set(groupKey, mergeSameFaceRows(existing, row, groupKey))
    }
    const deduped = [...merged.values()]
    rows.length = 0
    rows.push(...deduped)
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

/**
 * 源内身份：数组形 `["214790",79090]` 的第一段就是指标身份（同一条发布的多个 measure 共用它）。
 * 非数组形（规范码）原样返回。**这是「源自己说的身份」，不是我们猜的映射。**
 */
export function sourceInternalIdOf(metricKey: string): string {
  const match = /^\["(\d+)"/.exec(metricKey)
  return match === null ? metricKey : `id:${match[1]}`
}

const hasCjk = (value: string): boolean => /[\u4e00-\u9fff]/.test(value)

/** 中英两条合成一条：中文名字段给中文那条，英文原文留给搜索；时间取更早/更晚的两个极端。 */
function mergeSameFaceRows(left: CalendarEventIndexRow, right: CalendarEventIndexRow, key: string): CalendarEventIndexRow {
  const zhSource = hasCjk(left.sourceLabel ?? '') || !hasCjk(right.sourceLabel ?? '') ? left : right
  const enSource = zhSource === left ? right : left
  const lastDates = [left.lastRelease?.date, right.lastRelease?.date].filter((value): value is string => value !== undefined).sort()
  const nextDates = [left.nextRelease?.date, right.nextRelease?.date].filter((value): value is string => value !== undefined).sort()
  return Object.freeze({
    ...zhSource,
    key,
    // **显示名留中文那条**（`sourceLabel`），英文那条塞进英文全称那一格——它只被搜索命中列使用，
    // 既不覆盖显示名，也不会让英文读者搜不到（英文原文仍是可搜字段之一）。
    ...(enSource.sourceLabel === undefined ? {} : englishSearchName(enSource.sourceLabel)),
    ...(lastDates.length === 0 ? {} : { lastRelease: { date: lastDates[lastDates.length - 1]!,
      ...(zhSource.lastRelease?.scheduledAt === undefined ? {} : { scheduledAt: zhSource.lastRelease.scheduledAt }) } }),
    ...(nextDates.length === 0 ? {} : { nextRelease: { date: nextDates[0]! } }),
    ...(zhSource.importance === undefined ? {} : { importance: zhSource.importance })
  })
}

/** 供 IPC 层与用例复用：游标 → 两个分量（避免各写一份解析）。 */
export const calendarEventIndexCursorParts = cursorKey
