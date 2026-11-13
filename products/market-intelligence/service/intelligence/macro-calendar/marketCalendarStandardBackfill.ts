import type { DatabaseSync } from 'node:sqlite'

import { narwhalCanonicalIdentityKey } from './marketCalendarMetricIdentity'
import { dualWriteMeasureRows } from './marketCalendarStandardDualWrite'
import { routeStandardRelease } from './marketCalendarStandardRowRouting'
import { ensureCalendarStandardTables, recordCalendarUnmapped }
  from './marketCalendarStandardTable'

/**
 * **从观测表回填标准表**（一次性，可重复跑）。
 *
 * 为什么需要：标准表只靠采集过程双写填进去，而 sweep 是**前向 30 天**、tick 只覆盖今天——
 * 过去的日期跑多少轮都不会进表，读者往前翻会看到一片空白，而且**分不清「那天没有发布」
 * 和「我们没回填」**。数据源就是已有观测表（narwhal 那一批），不重新采集、不重新解析。
 *
 * 四条边界：
 * 1. **分流只有一处**：每条发布都问 `routeStandardRelease`——指标行 / 事件码行 / 源内身份行 /
 *    算不出身份。回填自己**不许再判一遍「这类怎么落」**：第一版只写了指标行，事件型 79 条
 *    静默消失，读者看到的是一段空日历。
 * 2. **幂等**：三类都走同一个写入端（按身份 upsert + 发布 id 台账），跑两次不新增。
 * 3. **算不出身份的不吞**：落 `unmapped` 并带原因，和采集时的规矩一致。
 * 4. **dry-run 只读**：`write: false` 时一个字节都不写，连建表都不做（库以只读方式打开）。
 */
export type StandardBackfillReport = Readonly<{
  observations: number
  /** 去重后的发布数：同一个发布可能有多条观测（每个 measure 一条、按批次重复）。 */
  releases: number
  indicator: number
  event: number
  source: number
  unmapped: Readonly<{ 'bad-identity': number }>
  skipped: number
  /** 真正交给写入端的行数；dry-run 时恒为 0（没有写）。 */
  written: number
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
  measure_keys_json: string | null
}>

const displayOf = (json: string | null): string | undefined => {
  if (json === null || json === '') return undefined
  try {
    const parsed = JSON.parse(json) as { displayValue?: unknown }
    return typeof parsed.displayValue === 'string' ? parsed.displayValue : undefined
  } catch { return undefined }
}

const hasMeasures = (json: string | null): boolean =>
  json !== null && json !== '' && json !== '[]' && json !== 'null'

export function backfillStandardRowsFromObservations(database: DatabaseSync, input?: Readonly<{
  providerId?: string
  observedAt?: string
  /** `false` = dry-run：只报数，不写库（也不建表）。 */
  write?: boolean
}>): StandardBackfillReport {
  const providerId = input?.providerId ?? 'narwhal'
  const write = input?.write ?? true
  if (write) ensureCalendarStandardTables(database)
  const exists = database.prepare("select 1 from sqlite_master where type = 'table' and name = 'mi_macro_calendar_market_event_observations'").get()
  if (exists === undefined) {
    return { observations: 0, releases: 0, indicator: 0, event: 0, source: 0,
      unmapped: { 'bad-identity': 0 }, skipped: 0, written: 0 }
  }
  // 同一个发布可能有多条观测（每个 measure 一条，按采集批次重复出现）：按**最新一条**取，
  // 再用发布 id 去重——回填只关心「这次发布最后是什么样」。
  const rows = database.prepare(`select source_event_id, market_fact_key, display_name, country_code,
    scheduled_date, scheduled_at, consensus_json, provider_previous_json, provider_actual_json, importance,
    measure_keys_json
    from mi_macro_calendar_market_event_observations
    where provider_id = ?
    order by source_event_id, coalesce(last_seen_at, '') asc`).all(providerId) as unknown as ObservationRow[]
  const latest = new Map<string, ObservationRow>()
  for (const row of rows) latest.set(String(row.source_event_id), row)
  const observedAt = input?.observedAt ?? new Date().toISOString()
  let indicator = 0
  let event = 0
  let source = 0
  let badIdentity = 0
  let skipped = 0
  const standardRows: Record<string, unknown>[] = []
  for (const row of latest.values()) {
    const identity = row.market_fact_key === null ? undefined : narwhalCanonicalIdentityKey(String(row.market_fact_key))
    const parts = identity?.split('|') ?? []
    if (identity === undefined || parts.length !== 3) {
      // 算不出身份：**不吞**，落工作清单（与采集时同一条规矩）。
      badIdentity += 1
      if (write) {
        recordCalendarUnmapped(database, { providerId, sourceKey: String(row.source_event_id),
          detectedAt: observedAt, rawJson: JSON.stringify({ name: row.display_name ?? '' }), reason: 'bad-identity' })
      }
      continue
    }
    const [countryCode, metricKey, periodKey] = parts as [string, string, string]
    const scheduledDate = String(row.scheduled_date ?? '')
    const scheduledAt = row.scheduled_at === null ? undefined : String(row.scheduled_at)
    const sourceName = String(row.display_name ?? '')
    // **分流只有这一处**：实时写入与回填问同一个函数。
    const route = routeStandardRelease({ hasPeriod: periodKey.length > 0,
      hasValues: hasMeasures(row.measure_keys_json), sourceName })
    if (route.kind === 'unmapped') {
      badIdentity += 1
      if (write) {
        recordCalendarUnmapped(database, { providerId, sourceKey: String(row.source_event_id),
          detectedAt: observedAt, rawJson: JSON.stringify({ name: sourceName }), reason: route.reason })
      }
      continue
    }
    // 事件型身份到分钟，没有时刻就落不了；其余两类至少要有日期。
    if (scheduledDate === '' || (route.kind === 'event' && scheduledAt === undefined)) {
      skipped += 1
      continue
    }
    const shared = {
      countryCode,
      scheduledDate,
      sourceEventId: String(row.source_event_id),
      ...(scheduledAt === undefined ? {} : { scheduledAt }),
      timePrecision: scheduledAt === undefined || scheduledAt.endsWith('T00:00:00.000Z') ? 'date' as const : 'minute' as const,
      ...(displayOf(row.provider_previous_json) === undefined
        ? {} : { previous: displayOf(row.provider_previous_json)! }),
      ...(displayOf(row.consensus_json) === undefined ? {} : { consensus: displayOf(row.consensus_json)! }),
      ...(displayOf(row.provider_actual_json) === undefined ? {} : { actual: displayOf(row.provider_actual_json)! }),
      ...(row.importance === null ? {} : { importance: row.importance as 'high' | 'medium' | 'low' })
    }
    if (route.kind === 'event') {
      // 事件型身份是（国家, `evt.*` 码, 到分钟）：period 用时刻本身，不借用指标期间。
      standardRows.push({ ...shared, metricKey: route.metricKey, periodKey: scheduledAt!.slice(0, 16) })
      event += 1
      continue
    }
    if (route.kind === 'source') {
      // 源内身份：源里确实有这次发布，只是还没有标准码——照样进日历，不跨源合并。
      standardRows.push({ ...shared, metricKey, periodKey,
        identityKind: 'source' as const, ...(sourceName === '' ? {} : { sourceLabel: sourceName }) })
      source += 1
      continue
    }
    standardRows.push({ ...shared, metricKey, periodKey })
    indicator += 1
  }
  let written = 0
  if (write && standardRows.length > 0) {
    written = dualWriteMeasureRows(database, { providerId, parserVersion: 'backfill-from-observations-v1',
      observedAt, rows: standardRows as never }).written
  }
  return { observations: rows.length, releases: latest.size, indicator, event, source,
    unmapped: { 'bad-identity': badIdentity }, skipped, written }
}
