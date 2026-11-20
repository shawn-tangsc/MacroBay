#!/usr/bin/env tsx
/**
 * **把「有映射、却没落库」的源内身份补进标准表**（只读观测，写标准表；默认 dry-run）。
 *
 * 2026-11-18 Chief：751 条「无标准行」的映射早就写好了，行却从没落库——它们因缺国家被跳过，
 * 之后再没人写回来。观测表里这 845 条**全都有行**，所以能按映射补：国家来自观测，
 * 码来自映射表（**必须同国家**），期次按映射的 `periodRule` 从发布时刻算。
 *
 * 用法：`pnpm tsx scripts/calendar-materialize-mapped-identities.mts <库路径> [--apply]`
 * 幂等：已有同国家+同码+同期的行就现有值不动；补过的条目从 `mi_calendar_unmapped` 移除。
 *
 * **`parser_version` 是「一次性补库」的标记**：跑过就留着，用来事后认出这批行
 * （2026-11-18 那次值编码收敛就按它筛选）。**不许重复跑**——重跑会拿观测表里的旧值
 * 覆盖运行时已经写好的行。
 */

import { ensureCalendarStandardTables, upsertCalendarStandardRow } from '../products/market-intelligence/service/intelligence/macro-calendar/marketCalendarStandardTable'
import { openSqliteDatabase } from '../platform/storage/sqlite/openSqliteDatabase'
import { markTempDirectoryVerified } from '../platform/storage/sqlite/tempDirectoryReadiness'
import { marketCalendarCountrySourceMappings } from '../products/market-intelligence/service/intelligence/macro-calendar/marketCalendarCountrySourceMappings'
import { periodFromSourceTitle } from '../products/market-intelligence/service/intelligence/macro-calendar/marketCalendarSourcePeriodFromTitle'
import { displayValueFromJson } from '../products/market-intelligence/service/intelligence/macro-calendar/marketCalendarValueEncoding'

const [dbPath, ...flags] = process.argv.slice(2)
if (dbPath === undefined) {
  console.error('用法：calendar-materialize-mapped-identities.mts <库路径> [--apply]')
  process.exit(1)
}
const apply = flags.includes('--apply')

/**
 * 期次**只从源标题解析**（`periodFromSourceTitle`），解不出就**不写**。
 *
 * 曾经这里按「发布月的上一个月」推算，2026-11-18 被 Chief 当场停住——那正是消费信贷
 * （9 月数据 11 月发布）被记成 10 月的错误。发布节奏不是统计期，任何按发布日推算的写法一律不用。
 */
markTempDirectoryVerified()

const database = openSqliteDatabase(dbPath, apply ? {} : { readOnly: true })
try {
  if (apply) ensureCalendarStandardTables(database)
  const unmapped = database.prepare(`select rowid, source_key from mi_calendar_unmapped
    where reason in ('no-standard-row', 'no-code')`).all() as { rowid: number; source_key: string }[]
  const observation = database.prepare(`select country_code, scheduled_at, scheduled_date, indicator_id, display_name,
    provider_actual_json, provider_previous_json, consensus_json, source_event_id
    from mi_macro_calendar_market_event_observations where source_event_id = ? order by scheduled_at desc limit 1`)
  let materialized = 0
  let skipped = 0
  let skippedNoPeriod = 0
  const touched = new Set<string>()
  const remove = database.prepare('delete from mi_calendar_unmapped where rowid = ?')
  for (const row of unmapped) {
    const parts = ((): string[] => {
      try {
        const value: unknown = JSON.parse(row.source_key)
        return Array.isArray(value) ? value.map((item: unknown) => String(item)) : []
      } catch { return [] }
    })()
    const entry = parts[0] === undefined ? undefined : marketCalendarCountrySourceMappings[parts[0]]
    const observationRow = observation.get(row.source_key) as Record<string, string | null> | undefined
    if (entry === undefined || observationRow === undefined || observationRow.country_code === null) { skipped += 1; continue }
    if (!entry.metricKey.startsWith(`${observationRow.country_code}.`)) { skipped += 1; continue }
    const scheduledAt = observationRow.scheduled_at ?? `${observationRow.scheduled_date ?? ''}T00:00:00.000Z`
    const scheduledDate = observationRow.scheduled_date ?? scheduledAt.slice(0, 10)
    // **源标题解析不出期次就跳过**：不猜、不按发布日推。
    const parsed = periodFromSourceTitle(String(observationRow.display_name ?? ''), scheduledDate)
    if (parsed === null) { skippedNoPeriod += 1; continue }
    /**
     * **三个值都走同一处解码**（用户 2026-11-18）：观测表那三列是 `{displayValue}` 的 JSON 文本，
     * 直接塞进 `values_json` 会双重编码（日报读出来是一条 JSON 串）。解析不出就**该字段缺席**，
     * 不拿原文顶、不填空串。
     */
    const actual = displayValueFromJson(observationRow.provider_actual_json)
    const previous = displayValueFromJson(observationRow.provider_previous_json)
    const consensus = displayValueFromJson(observationRow.consensus_json)
    if (apply) {
      upsertCalendarStandardRow(database, {
        countryCode: observationRow.country_code, metricKey: entry.metricKey,
        periodKey: parsed.periodKey,
        scheduledDate: (observationRow.scheduled_date ?? scheduledAt.slice(0, 10)),
        scheduledAt, timePrecision: 'minute',
        valuesJson: JSON.stringify({
          ...(previous === undefined ? {} : { previous }),
          ...(consensus === undefined ? {} : { consensus }),
          ...(actual === undefined ? {} : { actual })
        }),
        sourceProviderId: 'narwhal', sourceEventId: row.source_key,
        parserVersion: 'materialize-mapped-v1', observedAt: new Date().toISOString(),
        firstSeenAt: new Date().toISOString(),
        identityKind: 'code', sourceLabel: undefined as unknown as string,
        status: actual === undefined ? 'scheduled' : 'published',
      })
      remove.run(row.rowid)
    }
    materialized += 1
    touched.add(entry.metricKey)
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', scanned: unmapped.length, materialized, skipped, skippedNoPeriod, codesWithData: touched.size }))
} finally {
  database.close()
}
