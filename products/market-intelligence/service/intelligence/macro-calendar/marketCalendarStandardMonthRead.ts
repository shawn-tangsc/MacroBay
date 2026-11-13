import type { DatabaseSync } from 'node:sqlite'

import { calendarStandardTablePolicy, type CalendarIdentityKind, type CalendarReleaseStatus }
  from './marketCalendarStandardTable'

/**
 * **读取侧的唯一入口**：一个月的日历行，从标准表读。
 *
 * 三条边界的写死方式：
 * 1. **日历语义默认看不到估算**：默认读只读视图（`row_kind = 'release'`）。分析侧要按身份取
 *    「最新估算」时才传 `includeEstimates: true`，那时读基表。**日历页不许传 `true`**——
 *    否则三次 GDP 即时预测会变成三次发布（用例钉住）。
 * 2. **「没有」与「读不到」两种状态**：这里失败就抛，由调用方翻译成 `unavailable`；
 *    返回空数组只有一种意思——这个月确实没有发布。
 * 3. 身份与出处一起给：稳定身份串（`国家|码|期间|首发布日`）、`observed_at`、来源 provider、
 *    时间精度、生命周期状态。少任何一个，消费方都会静默少东西。
 */
export type StandardMonthRow = Readonly<{
  /** 稳定身份：同一行永远同一个串，跨查询可比。 */
  identityKey: string
  countryCode: string
  metricKey: string
  periodKey: string
  firstScheduledDate: string
  scheduledDate: string
  scheduledAt?: string
  timePrecision: 'minute' | 'date'
  rowKind: 'release' | 'estimate'
  status: CalendarReleaseStatus
  identityKind: CalendarIdentityKind
  /** `source` 身份行才有：源原文名（标准码的显示名去名表查）。 */
  sourceLabel?: string
  sourceProviderId: string
  sourceEventId: string
  observedAt: string
  /** 值：键是 `actual` / `previous` / `consensus`；空对象＝没有值。 */
  values: Readonly<Record<string, string>>
}>

const monthBounds = (month: string): Readonly<{ start: string; endExclusive: string }> => {
  const [year, monthNumber] = month.split('-').map(Number)
  const end = new Date(Date.UTC(year!, (monthNumber ?? 1) - 1, 1))
  end.setUTCMonth(end.getUTCMonth() + 1)
  return { start: `${month}-01`, endExclusive: end.toISOString().slice(0, 10) }
}

export function readStandardCalendarMonth(database: DatabaseSync, input: Readonly<{
  month: string
  limit?: number
  /** 分析侧按身份取估算时用；**日历调用点不许传 `true`**。 */
  includeEstimates?: boolean
}>): readonly StandardMonthRow[] {
  const { start, endExclusive } = monthBounds(input.month)
  const source = input.includeEstimates === true
    ? calendarStandardTablePolicy.eventsTable
    : calendarStandardTablePolicy.releasesView
  const rows = database.prepare(`select country_code, metric_key, period_key, first_scheduled_date,
    scheduled_date, scheduled_at, time_precision, row_kind, status, identity_kind, source_label,
    source_provider_id, source_event_id, observed_at, values_json
    from ${source}
    where scheduled_date >= ? and scheduled_date < ?
    order by scheduled_date, scheduled_at, metric_key
    limit ?`).all(start, endExclusive, input.limit ?? 500) as Record<string, unknown>[]
  return rows.map((row) => ({
    identityKey: `${String(row.country_code)}|${String(row.metric_key)}|${String(row.period_key)}|${String(row.first_scheduled_date)}`,
    countryCode: String(row.country_code), metricKey: String(row.metric_key),
    periodKey: String(row.period_key), firstScheduledDate: String(row.first_scheduled_date),
    scheduledDate: String(row.scheduled_date),
    ...(row.scheduled_at === null ? {} : { scheduledAt: String(row.scheduled_at) }),
    timePrecision: String(row.time_precision) === 'minute' ? 'minute' as const : 'date' as const,
    rowKind: String(row.row_kind) === 'estimate' ? 'estimate' as const : 'release' as const,
    status: (['scheduled', 'published', 'cancelled', 'unknown'].includes(String(row.status))
      ? String(row.status) : 'unknown') as CalendarReleaseStatus,
    identityKind: String(row.identity_kind) === 'source' ? 'source' as const : 'code' as const,
    ...(row.source_label === null ? {} : { sourceLabel: String(row.source_label) }),
    sourceProviderId: String(row.source_provider_id), sourceEventId: String(row.source_event_id),
    observedAt: String(row.observed_at),
    values: JSON.parse(String(row.values_json)) as Record<string, string>
  }))
}

/**
 * **某个指标下一次发布**：返回下一期的期次与发布时刻，读不到就明确说「没有排期」。
 *
 * 用途：盘口共识要知道「查哪一期的盘」——查今天或上一期都会拿错盘（发布后的盘是结果，
 * 不是预期）。所以这里只回答一个问题：`asOf` 之后这个指标**最近一次**排期是什么。
 *
 * 两条边界：
 * 1. **绝不编期次**：没有排期就返回 `undefined`，让调用方说「暂无排期」。编一个期次会去查
 *    一个不存在的盘，而那个查询看起来完全正常——最难发现的一类错；
 * 2. 只读视图（`row_kind = 'release'`）：估算不是发布，不能拿它当「下一次发布」。
 */
export function readNextReleaseForMetric(database: DatabaseSync, input: Readonly<{
  metricKey: string
  asOf: string
}>): Readonly<{ period: string; releaseAt: string }> | undefined {
  const row = database.prepare(`select scheduled_date, period_key, scheduled_at
    from ${calendarStandardTablePolicy.releasesView}
    where metric_key = ? and scheduled_date > ?
    order by scheduled_date asc, coalesce(scheduled_at, '') asc
    limit 1`).get(input.metricKey, input.asOf.slice(0, 10)) as Record<string, unknown> | undefined
  if (row === undefined) return undefined
  // 形状对齐盘口现查器的入参：`{ metricKey, period, releaseAt, asOf }`。少给期次它就会查错盘，
  // 所以缺 `scheduled_at` 时用当天 00:00（**日期粒度的发布日**），不编时刻。
  return {
    period: String(row.period_key),
    releaseAt: row.scheduled_at === null ? `${String(row.scheduled_date)}T00:00:00.000Z` : String(row.scheduled_at)
  }
}
