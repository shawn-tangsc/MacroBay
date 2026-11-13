import type { DatabaseSync } from 'node:sqlite'

/**
 * 标准日历表：**一行 = 一次发布**。主键 = 身份 `(country_code, metric_key, period_key)` +
 * **首次发布日** `first_scheduled_date`（UTC 日期，冻结）。
 *
 * 为什么第 4 列是**日期**而不是时刻：官方源（BLS 日程等）只给日期、不给时刻，市场行有 13:30。
 * 用分钟做键，同一次发布就成了两行；而**日期是两边都拿得到的粒度**。日期已足够区分「哪一次发布」
 * （初值 11-06 / 终值 11-20 是两天），不需要分钟。
 *
 * **绝不推算时刻**：源没给就留空、`time_precision = 'date'`。推一个「惯例的 8:30」会把编造的时间
 * 印给读者，而且推出来的时刻一旦进键和界面，就再也分不清哪条是源说的、哪条是我们猜的。
 *
 * 显示用两列：`scheduled_date`（可变，跨日改期就改它）与 `scheduled_at`（可空，源给到分钟才有）。
 * 合并时取精度是 `minute` 的那一方——官方没有时刻，优先它就是拿空值盖掉 13:30。
 *
 * 两列拆开才有「改期仍是一行」：`first_scheduled_date` 冻结且在主键里；`scheduled_date`/`scheduled_at`
 * 只做显示，源改期就跟着变。**认回「同一次发布」先按源内 id**（`source_provider_id` + `source_event_id`）：
 * 命中就是同一次发布，只更新显示时刻/值/观测时间；找不到才按主键插入。**不写「差几小时内算同一次」
 * 这种容差**——那是替源做判断，判错就把两次发布并成一次，正是要防的事。
 *
 * 与观测表的区别（观测表是**采集日志**，别混）：这里没有 `collection_id`/`descriptor_id`
 * ——那两个回答的是「哪一次采集、哪个端点」，属于采集层。读取层只读这张表，因此「不感知源」。
 *
 * **`first_published_*` 两列冻结**：身份一次发布的值会被来源修订，而卡片上「较上期（未修正）」
 * 必须永远用**第一次看到时的 previous**（非农首次 29、修订后 60，用 60 会算出 +105K 而不是
 * +136K）。所以这两列 `insert` 时写、`update` 时**不碰**——修订覆盖 `values_json`，冻结首发布值。
 * 不另开一张快照表：同一行能回答的问题，不该跨表 join，更不该再养一张「语义脆」的表。
 */
export const calendarStandardTablePolicy = Object.freeze({
  eventsTable: 'mi_calendar_events',
  /** 日历的唯一读入口（只含 `row_kind = 'release'`）。 */
  releasesView: 'mi_calendar_releases',
  unmappedTable: 'mi_calendar_unmapped',
  /** 没映射上的原因闭集。新增值要同时更新这里的注释与用例。 */
  unmappedReasons: Object.freeze(['unknown-measure', 'unknown-event-type', 'bad-period', 'bad-identity',
    'unknown-release-group', 'ambiguous-same-day'] as const)
})
export type CalendarUnmappedReason = typeof calendarStandardTablePolicy.unmappedReasons[number]

export type CalendarStandardRow = Readonly<{
  countryCode: string
  metricKey: string
  periodKey: string
  /** 显示用的发布日：跨日改期就变，**不在主键里**。 */
  scheduledDate: string
  /** 显示用的发布时刻：源给到分钟才有，没有就**留空**（不推）。 */
  scheduledAt?: string
  /** 首次看到的发布日（UTC）：冻结，**在主键里**。不传时取 `scheduledDate`。 */
  firstScheduledDate?: string
  timePrecision: 'minute' | 'date'
  valuesJson: string
  sourceProviderId: string
  sourceEventId: string
  parserVersion: string
  observedAt: string
  firstSeenAt: string
  /**
   * 行类型：`release` 是一次发布，`estimate` 是**随时更新的估算**（GDP 即时预测那类）。
   * 日历只取 `release`；分析与卡片按身份可读全部——同一个数在日历里错（三次估算像三次发布）、
   * 在卡片里对（最新值就是估算）。**不记 `unmapped`**：它不是映射不上，是本来就不是发布。
   */
  rowKind?: 'release' | 'estimate'
  /** 第一次看到这一期时来源给的 actual / previous；之后修订**不覆盖**，没有就不写。 */
  firstPublishedActual?: string
  firstPublishedPrevious?: string
}>

export function ensureCalendarStandardTables(database: DatabaseSync): void {
  const { eventsTable, unmappedTable } = calendarStandardTablePolicy
  database.exec(`
    create table if not exists ${eventsTable} (
      country_code text not null,
      metric_key text not null,
      period_key text not null,
      scheduled_date text not null,
      first_scheduled_date text not null,
      scheduled_at text,
      time_precision text not null check(time_precision in ('minute', 'date')),
      row_kind text not null default 'release' check(row_kind in ('release', 'estimate')),
      values_json text not null,
      source_provider_id text not null,
      source_event_id text not null,
      parser_version text not null,
      observed_at text not null,
      first_seen_at text not null,
      first_published_actual text,
      first_published_previous text,
      primary key(country_code, metric_key, period_key, first_scheduled_date)
    );
    -- **日历只读视图**：一个入口，条件写在这里，不靠每个调用点记得加。
    -- 同表两种行时，「每处都记得 where」是不可靠的：漏一处，估算就混进日历，而且图上看不出来。
    drop view if exists ${calendarStandardTablePolicy.releasesView};
    create view ${calendarStandardTablePolicy.releasesView} as
      select * from ${eventsTable} where row_kind = 'release';
    create index if not exists idx_calendar_events_month
      on ${eventsTable}(country_code, scheduled_at);
    create table if not exists ${unmappedTable} (
      provider_id text not null,
      source_key text not null,
      detected_at text not null,
      raw_json text not null,
      reason text not null,
      primary key(provider_id, source_key, detected_at)
    );
  `)
}

/**
 * 写一行标准事件。**修订覆盖值，但冻结首发布两列**——`on conflict` 的 `do update` 里
 * 刻意不出现 `first_published_*`，也不写 `first_seen_at`。
 */
export function upsertCalendarStandardRow(database: DatabaseSync, row: CalendarStandardRow): void {
  const { eventsTable } = calendarStandardTablePolicy
  database.prepare(`insert into ${eventsTable}
    (country_code, metric_key, period_key, scheduled_date, first_scheduled_date, scheduled_at, time_precision, row_kind,
     values_json, source_provider_id, source_event_id, parser_version, observed_at, first_seen_at,
     first_published_actual, first_published_previous)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(country_code, metric_key, period_key, first_scheduled_date) do update set
      scheduled_date = excluded.scheduled_date,
      scheduled_at = excluded.scheduled_at,
      time_precision = excluded.time_precision,
      values_json = excluded.values_json,
      source_provider_id = excluded.source_provider_id,
      source_event_id = excluded.source_event_id,
      parser_version = excluded.parser_version,
      observed_at = excluded.observed_at`)
    .run(row.countryCode, row.metricKey, row.periodKey, row.scheduledDate,
      row.firstScheduledDate ?? row.scheduledDate, row.scheduledAt ?? null, row.timePrecision,
      row.rowKind ?? 'release',
      row.valuesJson, row.sourceProviderId, row.sourceEventId, row.parserVersion, row.observedAt, row.firstSeenAt,
      row.firstPublishedActual ?? null, row.firstPublishedPrevious ?? null)
}

/** 没映射上的行：进 `unmapped`，**不进日历**；补上映射后按 `raw_json` 重放。 */
export function recordCalendarUnmapped(database: DatabaseSync, input: Readonly<{
  providerId: string; sourceKey: string; detectedAt: string; rawJson: string; reason: CalendarUnmappedReason
}>): void {
  const { unmappedTable } = calendarStandardTablePolicy
  database.prepare(`insert or ignore into ${unmappedTable}
    (provider_id, source_key, detected_at, raw_json, reason) values (?, ?, ?, ?, ?)`)
    .run(input.providerId, input.sourceKey, input.detectedAt, input.rawJson, input.reason)
}

/**
 * 按**源内 id** 找回同一次发布（`source_provider_id` + `source_event_id`）。
 *
 * 这是「改期仍是一行」的唯一判据：先按源内 id 找，命中的就是同一次发布，更新显示时刻/值即可；
 * 找不到才按主键插入。**不用时间容差**——那等于替源判断「差几小时算同一次」，判错就把两次
 * 真实发布并成一次。
 */
export function findCalendarStandardRowBySource(database: DatabaseSync, input: Readonly<{
  sourceProviderId: string; sourceEventId: string
}>): Readonly<{ countryCode: string; metricKey: string; periodKey: string
  firstScheduledDate: string; sourceEventId: string }> | undefined {
  const { eventsTable } = calendarStandardTablePolicy
  const row = database.prepare(`select country_code, metric_key, period_key, first_scheduled_date, source_event_id
    from ${eventsTable} where source_provider_id = ? and source_event_id = ? limit 1`)
    .get(input.sourceProviderId, input.sourceEventId) as Record<string, unknown> | undefined
  return row === undefined ? undefined : {
    countryCode: String(row.country_code), metricKey: String(row.metric_key),
    periodKey: String(row.period_key), firstScheduledDate: String(row.first_scheduled_date),
    sourceEventId: String(row.source_event_id)
  }
}
