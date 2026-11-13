import type { DatabaseSync } from 'node:sqlite'

import { narwhalCanonicalIdentityKey } from './marketCalendarMetricIdentity'
import { dualWriteMeasureRows } from './marketCalendarStandardDualWrite'
import { ensureCalendarStandardTables, recordCalendarSourceId, recordCalendarUnmapped }
  from './marketCalendarStandardTable'

/**
 * **从观测表回填标准表**（一次性，可重复跑）。
 *
 * 为什么需要：标准表只靠采集过程双写填进去，而 sweep 是**前向 30 天**、tick 只覆盖今天——
 * 过去的日期跑多少轮都不会进表，读者往前翻会看到一片空白，而且**分不清「那天没有发布」
 * 和「我们没回填」**。数据源就是已有观测表（narwhal 那一批），不重新采集、不重新解析。
 *
 * 三条边界：
 * 1. **幂等**：走同一个写入端（按身份 upsert + 发布 id 台账），跑两次不新增；
 * 2. **算不出身份的不吞**：落 `unmapped` 并带原因，和采集时的规矩一致；
 * 3. **只补缺失**：已经落过表且不再变化的发布，写入端会命中同一行，不会制造第二行。
 */
export type StandardBackfillReport = Readonly<{
  observations: number
  written: number
  unmapped: number
  skipped: number
}>

type ObservationRow = Readonly<{
  source_event_id: string
  market_fact_key: string | null
  display_name: string | null
  country_code: string | null
  scheduled_date: string | null
  scheduled_at: string | null
  consensus_json: string | null
  provider_previous_json: string | null
  provider_actual_json: string | null
  importance: string | null
}>

const displayOf = (json: string | null): string | undefined => {
  if (json === null || json === '') return undefined
  try {
    const parsed = JSON.parse(json) as { displayValue?: unknown }
    return typeof parsed.displayValue === 'string' ? parsed.displayValue : undefined
  } catch { return undefined }
}

export function backfillStandardRowsFromObservations(database: DatabaseSync, input?: Readonly<{
  providerId?: string
  observedAt?: string
}>): StandardBackfillReport {
  const providerId = input?.providerId ?? 'narwhal'
  ensureCalendarStandardTables(database)
  const exists = database.prepare("select 1 from sqlite_master where type = 'table' and name = 'mi_macro_calendar_market_event_observations'").get()
  if (exists === undefined) return { observations: 0, written: 0, unmapped: 0, skipped: 0 }
  // 同一个发布可能有多条观测（每个 measure 一条，按采集批次重复出现）：按**最新一条**取，
  // 再用发布 id 去重——回填只关心「这次发布最后是什么样」。
  const rows = database.prepare(`select source_event_id, market_fact_key, display_name, country_code,
    scheduled_date, scheduled_at, consensus_json, provider_previous_json, provider_actual_json, importance
    from mi_macro_calendar_market_event_observations
    where provider_id = ?
    order by source_event_id, coalesce(last_seen_at, '') asc`).all(providerId) as unknown as ObservationRow[]
  const latest = new Map<string, ObservationRow>()
  for (const row of rows) latest.set(String(row.source_event_id), row)
  const observedAt = input?.observedAt ?? new Date().toISOString()
  let written = 0
  let unmapped = 0
  let skipped = 0
  const standardRows: Record<string, unknown>[] = []
  for (const row of latest.values()) {
    const identity = row.market_fact_key === null ? undefined : narwhalCanonicalIdentityKey(String(row.market_fact_key))
    const parts = identity?.split('|') ?? []
    if (identity === undefined || parts.length !== 3) {
      // 算不出身份：**不吞**，落工作清单（与采集时同一条规矩）。
      recordCalendarUnmapped(database, { providerId, sourceKey: String(row.source_event_id),
        detectedAt: observedAt, rawJson: JSON.stringify({ name: row.display_name ?? '' }), reason: 'bad-identity' })
      unmapped += 1
      continue
    }
    const [countryCode, metricKey, periodKey] = parts as [string, string, string]
    const scheduledDate = String(row.scheduled_date ?? '')
    if (scheduledDate === '') { skipped += 1; continue }
    standardRows.push({
      countryCode, metricKey, periodKey, scheduledDate,
      ...(row.scheduled_at === null ? {} : { scheduledAt: String(row.scheduled_at) }),
      timePrecision: row.scheduled_at === null ? 'date' as const : 'minute' as const,
      sourceEventId: String(row.source_event_id),
      ...(displayOf(row.provider_previous_json) === undefined
        ? {} : { previous: displayOf(row.provider_previous_json)! }),
      ...(displayOf(row.consensus_json) === undefined ? {} : { consensus: displayOf(row.consensus_json)! }),
      ...(displayOf(row.provider_actual_json) === undefined ? {} : { actual: displayOf(row.provider_actual_json)! }),
      ...(row.importance === null ? {} : { importance: row.importance as 'high' | 'medium' | 'low' })
    })
  }
  if (standardRows.length > 0) {
    const counts = dualWriteMeasureRows(database, { providerId, parserVersion: 'backfill-from-observations-v1',
      observedAt, rows: standardRows as never })
    written = counts.written
  }
  for (const row of standardRows) {
    // 台账：回填过的发布 id 也要能按 id 溯源（与采集时同一条规则）。
    recordCalendarSourceId(database, { providerId, sourceEventId: String(row.sourceEventId),
      countryCode: String(row.countryCode), metricKey: String(row.metricKey), periodKey: String(row.periodKey),
      firstScheduledDate: String(row.scheduledDate), observedAt })
  }
  return { observations: latest.size, written, unmapped, skipped }
}
