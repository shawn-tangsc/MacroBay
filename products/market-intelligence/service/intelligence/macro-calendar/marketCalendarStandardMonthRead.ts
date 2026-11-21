import type { DatabaseSync } from 'node:sqlite'

import { marketCalendarPublicPolicy } from '../../../contracts/macro/marketCalendarQueryContracts'

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
const parseReleaseDates = (json: string): readonly string[] => {
  try {
    const parsed = JSON.parse(json) as unknown
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch { return [] }
}

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
  /** 这一期的每一次排期（合并前那几行的日期，升序）；只有合并过的行才有。 */
  releaseDates?: readonly string[]
  /** 这一期发布过几次（同源多次真实发布 / 跨源合并前的行数）；缺省按 1。 */
  releaseCount?: number
  /** 写入侧存下来的「这是什么」；空值＝还没回填，读侧退前缀规则。 */
  eventType?: 'economic-indicator' | 'financial-event' | 'central-bank-activity'
  status: CalendarReleaseStatus
  identityKind: CalendarIdentityKind
  /** `source` 身份行才有：源原文名（标准码的显示名去名表查）。 */
  sourceLabel?: string
  /** 源原文名的英文版（标准表有 `source_label_en` 这一列）：英文界面的回退用它，不出中文原文名。 */
  sourceLabelEn?: string
  /**
   * **源自己的稳定指标 id**（`series_id`）：登记过的显示名按它查，不按 `metric_key`——
   * 数组身份第一段每次发布都换一个，拿它查登记表永远落空。
   */
  seriesId?: string
  sourceProviderId: string
  sourceEventId: string
  observedAt: string
  /** 值：键是 `actual` / `previous` / `consensus`；空对象＝没有值。 */
  values: Readonly<Record<string, string>>
  /**
   * 源给的重要性；**没有就是没有**（不出现在这个对象里）。标准表这一列本来可空——
   * 早先读侧拿不到它，就在适配器里写了 `medium` 顶，结果官方那 51 行 high 全被压成 medium，
   * 读者看到的「没有高影响事件」一半是这个压出来的。
   */
  importance?: 'high' | 'medium' | 'low'
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
    scheduled_date, scheduled_at, time_precision, row_kind, status, identity_kind, source_label, source_label_en, series_id, importance, event_type, release_count, release_dates_json,
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
    // **这一期发布过几次**（合并后仍保留）：二读/三读不显示次数，读者就会把二读当初值。
    releaseCount: Number(row.release_count ?? 1),
    ...(row.release_dates_json === null ? {} : { releaseDates: parseReleaseDates(String(row.release_dates_json)) }),
    // 写入侧存下来的「这是什么」；空值留给适配器退前缀规则（不是默认成经济指标）。
    ...(row.event_type === null ? {} : { eventType: String(row.event_type) as 'economic-indicator' | 'financial-event' | 'central-bank-activity' }),
    // 闭集从契约派生，不在读侧再写一遍字面量。
    status: (marketCalendarPublicPolicy.releaseStatuses as readonly string[]).includes(String(row.status))
      ? String(row.status) as CalendarReleaseStatus : 'unknown',
    identityKind: String(row.identity_kind) === 'source' ? 'source' as const : 'code' as const,
    ...(row.source_label === null ? {} : { sourceLabel: String(row.source_label) }),
    ...(row.source_label_en === null || row.source_label_en === undefined ? {}
      : { sourceLabelEn: String(row.source_label_en) }),
    ...(row.series_id === null || row.series_id === undefined || String(row.series_id).trim() === ''
      ? {} : { seriesId: String(row.series_id) }),
    sourceProviderId: String(row.source_provider_id), sourceEventId: String(row.source_event_id),
    observedAt: String(row.observed_at),
    values: JSON.parse(String(row.values_json)) as Record<string, string>,
    // 源给的重要性；**没有就不出这个字段**（不拿 medium 顶，那等于替源下判断）。
    ...(row.importance === null || row.importance === undefined ? {}
      : { importance: String(row.importance) as 'high' | 'medium' | 'low' })
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
}>): Readonly<{ period: string; releaseAt: string; timePrecision: 'minute' | 'date' }> | undefined {
  /**
   * 谓词三层，**不能一刀切比日期**（架构师 2026-11-14 抓到）：
   * 1. 日期先设下界且**含今天**——以前是 `scheduled_date > 今天` 严格大于，于是「今天 21:30 那场」
   *    在上午 10:00 被整场跳过，卡片显示「下次发布 12-10」，而事实是今晚就有一场；
   * 2. 只有日期（`scheduled_at` 为空）→ 今天就算，因为我们不知道几点，但读者需要知道「今天有」；
   * 3. 有时刻 → 同一日期上看**时刻**：今天没到点的仍算下一次，过了的不算。
   */
  const row = database.prepare(`select scheduled_date, period_key, scheduled_at, time_precision
    from ${calendarStandardTablePolicy.releasesView}
    where metric_key = ?
      and scheduled_date >= ?
      and ( scheduled_at is null
         or scheduled_date > ?
         or scheduled_at > ? )
    order by scheduled_date asc, coalesce(scheduled_at, '') asc
    limit 1`).get(
    input.metricKey,
    input.asOf.slice(0, 10),
    input.asOf.slice(0, 10),
    input.asOf
  ) as Record<string, unknown> | undefined
  if (row === undefined) return undefined
  // 形状对齐盘口现查器的入参：`{ metricKey, period, releaseAt, asOf }`。少给期次它就会查错盘，
  // 所以缺 `scheduled_at` 时用当天 00:00（**日期粒度的发布日**），不编时刻。
  // **必须一起给精度**：日期型的 `releaseAt` 是当天 00:00 的占位，不是真时刻；不给精度，
  // 下游照着它倒计时就是在编时间（「还有 3 小时」而源从没说过几点）。
  return {
    period: String(row.period_key),
    releaseAt: row.scheduled_at === null ? `${String(row.scheduled_date)}T00:00:00.000Z` : String(row.scheduled_at),
    timePrecision: String(row.time_precision) === 'minute' ? 'minute' as const : 'date' as const
  }
}
