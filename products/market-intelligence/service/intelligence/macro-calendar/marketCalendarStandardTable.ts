import type { DatabaseSync } from 'node:sqlite'

/**
 * 标准日历表：**一身份一行**，主键就是身份 `(country_code, metric_key, period_key)`。
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
  unmappedTable: 'mi_calendar_unmapped',
  /** 没映射上的原因闭集。新增值要同时更新这里的注释与用例。 */
  unmappedReasons: Object.freeze(['unknown-measure', 'unknown-event-type', 'bad-period', 'bad-identity'] as const)
})
export type CalendarUnmappedReason = typeof calendarStandardTablePolicy.unmappedReasons[number]

export type CalendarStandardRow = Readonly<{
  countryCode: string
  metricKey: string
  periodKey: string
  scheduledDate: string
  scheduledAt: string
  timePrecision: 'minute' | 'date'
  valuesJson: string
  sourceProviderId: string
  sourceEventId: string
  parserVersion: string
  observedAt: string
  firstSeenAt: string
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
      scheduled_at text not null,
      time_precision text not null check(time_precision in ('minute', 'date')),
      values_json text not null,
      source_provider_id text not null,
      source_event_id text not null,
      parser_version text not null,
      observed_at text not null,
      first_seen_at text not null,
      first_published_actual text,
      first_published_previous text,
      primary key(country_code, metric_key, period_key)
    );
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
    (country_code, metric_key, period_key, scheduled_date, scheduled_at, time_precision, values_json,
     source_provider_id, source_event_id, parser_version, observed_at, first_seen_at,
     first_published_actual, first_published_previous)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(country_code, metric_key, period_key) do update set
      scheduled_date = excluded.scheduled_date,
      scheduled_at = excluded.scheduled_at,
      time_precision = excluded.time_precision,
      values_json = excluded.values_json,
      source_provider_id = excluded.source_provider_id,
      source_event_id = excluded.source_event_id,
      parser_version = excluded.parser_version,
      observed_at = excluded.observed_at`)
    .run(row.countryCode, row.metricKey, row.periodKey, row.scheduledDate, row.scheduledAt, row.timePrecision,
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
