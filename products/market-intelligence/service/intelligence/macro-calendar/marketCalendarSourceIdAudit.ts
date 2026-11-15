import type { DatabaseSync } from 'node:sqlite'

import { toAlpha2Country } from './marketCalendarMetricIdentity'

/**
 * 「行上记的发布 id」与「台账里的发布 id」不一致的测量。
 *
 * 标准表一行只能存一个 `source_event_id`，而台账（`mi_calendar_event_source_ids`）记每一次发布；
 * 同一次发布被后写覆盖时，两个 id 天然不同。这不是丢行，但**必须量出来**：数量、月份、两个 id，
 * 而且**只允许「同一次发布被后写覆盖」这一种情形**——台账有、表里查不到行，就是真丢失，要红。
 *
 * 这里只读、只返回事实，不修数据：什么时候报由调用方决定。
 */
export type SourceIdTables = Readonly<{ eventsTable: string; sourceIdsTable: string }>

export type SourceIdMismatch = Readonly<{
  month: string
  countryCode: string
  metricKey: string
  firstScheduledDate: string
  /** 台账记下的那次发布 id。 */
  ledgerSourceEventId: string
  /** 行上现在写着的 id；`null` = 台账有这次发布，但表里找不到它的行（真丢失）。 */
  rowSourceEventId: string | null
}>

export function auditSourceIdMismatches(database: DatabaseSync, tables: SourceIdTables): readonly SourceIdMismatch[] {
  try {
    const rows = database.prepare(`select substr(l.first_scheduled_date, 1, 7) as month,
        l.country_code as country_code, l.metric_key as metric_key, l.first_scheduled_date as first_scheduled_date,
        l.source_event_id as ledger_id, e.source_event_id as row_id
      from ${tables.sourceIdsTable} l
      left join ${tables.eventsTable} e
        on e.country_code = l.country_code and e.metric_key = l.metric_key
        and e.period_key = l.period_key and e.first_scheduled_date = l.first_scheduled_date
      where e.source_event_id is null or e.source_event_id <> l.source_event_id
      order by l.first_scheduled_date, l.source_event_id`).all() as Array<Record<string, unknown>>
    return Object.freeze(rows.map((row) => Object.freeze({
      month: String(row.month),
      countryCode: String(row.country_code),
      metricKey: String(row.metric_key),
      firstScheduledDate: String(row.first_scheduled_date),
      ledgerSourceEventId: String(row.ledger_id),
      rowSourceEventId: row.row_id === null ? null : String(row.row_id)
    })))
  } catch {
    // 诊断不许把写入带崩：量不出来就是量不出来，不当成 0。
    return Object.freeze([])
  }
}

/**
 * 写之前查一眼：这个身份的行现在写着另一个发布 id 吗？
 *
 * 覆盖本身是设计允许的（一行只能存一个 id），所以返回事实并**只打日志**；判断是否合规交给
 * 日志里那两个标记：
 * - `MI_CALENDAR_SOURCE_ID_OVERWRITTEN`：旧 id 在台账里（同一次发布被后写覆盖，允许）；
 * - `MI_CALENDAR_SOURCE_ID_OVERWRITTEN_UNTRACED`：旧 id 不在台账里（没有留痕的覆盖，真红）。
 */
export function sourceIdOverwriteOnWrite(
  database: DatabaseSync,
  tables: SourceIdTables,
  input: Readonly<{
    countryCode: string; metricKey: string; periodKey: string
    firstScheduledDate: string; sourceEventId: string
  }>
): Readonly<{ month: string; previousSourceEventId: string; nextSourceEventId: string; tracedInLedger: boolean }> | undefined {
  try {
    // 国家码在写入端已归一到 alpha-2，这里按同一口径查，否则「旧写法进来的写」会被当成「新行」而漏报。
    const previous = database.prepare(`select source_event_id as id from ${tables.eventsTable}
      where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ? limit 1`)
      .get(toAlpha2Country(input.countryCode), input.metricKey, input.periodKey, input.firstScheduledDate) as
      { id?: unknown } | undefined
    if (previous?.id === undefined || String(previous.id) === input.sourceEventId) return undefined
    const previousSourceEventId = String(previous.id)
    const traced = database.prepare(`select 1 as hit from ${tables.sourceIdsTable}
      where source_event_id = ? and metric_key = ? and first_scheduled_date = ? limit 1`)
      .get(previousSourceEventId, input.metricKey, input.firstScheduledDate) as { hit?: unknown } | undefined
    const tracedInLedger = traced !== undefined
    const payload = {
      month: input.firstScheduledDate.slice(0, 7),
      metricKey: input.metricKey,
      previousSourceEventId,
      nextSourceEventId: input.sourceEventId,
      tracedInLedger
    }
    console.warn(`[macro-calendar] ${tracedInLedger ? 'MI_CALENDAR_SOURCE_ID_OVERWRITTEN' : 'MI_CALENDAR_SOURCE_ID_OVERWRITTEN_UNTRACED'} ${JSON.stringify(payload)}`)
    return Object.freeze(payload)
  } catch {
    return undefined
  }
}
