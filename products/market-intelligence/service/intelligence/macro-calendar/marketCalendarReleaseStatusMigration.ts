import type { DatabaseSync } from 'node:sqlite'

import { calendarStandardTablePolicy } from './marketCalendarStandardTable'

/**
 * 把 `mi_calendar_events.status` 的 CHECK 从四值扩到**五值**（加 `backfilling` / `missing`）。
 *
 * SQLite 改不了 CHECK，只能重建表。四条硬约束（Chief 2026-11-16 定）：
 * 1. **不 drop 旧表**：建新表（临时名）→ 逐列 `insert … select` → **行数对账** →
 *    旧表 `rename to …__pre_v13` → 新表 `rename` 成正名；
 * 2. **视图会被 RENAME 改写**：`mi_calendar_releases` 的定义引用这张表，`rename` 之后必须
 *    **显式 `drop view` + 重建**，否则视图指向 `__pre_v13`；
 * 3. **外键**：`pragma foreign_keys = off` 在事务外开，迁移后 `pragma foreign_key_check` 必须无输出；
 * 4. **幂等**：判据是「CHECK 已含 backfilling/missing」**且**「旧表 `__pre_v13` 存在」两条同时成立。
 */
export const releaseStatusMigrationPolicy = Object.freeze({
  backupTable: 'mi_calendar_events__pre_v13',
  /** 闭集**只引用契约那一份**，不在这里再抄一遍值。 */
  statuses: calendarStandardTablePolicy.releaseStatuses
})

const columns = Object.freeze([
  'country_code', 'metric_key', 'period_key', 'scheduled_date', 'first_scheduled_date', 'scheduled_at',
  'time_precision', 'status', 'identity_kind', 'source_label', 'series_id', 'importance', 'value_state',
  'row_kind', 'values_json', 'source_provider_id', 'source_event_id', 'parser_version', 'observed_at',
  'first_seen_at', 'first_published_actual', 'first_published_previous'
] as const)

function statusCheckExtended(database: DatabaseSync): boolean {
  const ddl = database.prepare("select sql from sqlite_master where type = 'table' and name = 'mi_calendar_events'")
    .get() as { sql: string } | undefined
  return ddl !== undefined && ddl.sql.includes("'backfilling'") && ddl.sql.includes("'missing'")
}

/** 迁移过的两条判据必须同时成立：CHECK 已扩 **且** 旧表还在（旧表留着当一个版本的回滚点）。 */
export function isReleaseStatusMigrationComplete(database: DatabaseSync): boolean {
  try {
    const backup = database.prepare("select 1 from sqlite_master where type = 'table' and name = ?")
      .get(releaseStatusMigrationPolicy.backupTable)
    return statusCheckExtended(database) && backup !== undefined
  } catch { return false }
}

export function ensureReleaseStatusCheckExtended(database: DatabaseSync): boolean {
  if (isReleaseStatusMigrationComplete(database)) return false
  const table = calendarStandardTablePolicy.eventsTable
  const rebuilt = `${table}__v13`
  database.exec('pragma foreign_keys = off')
  try {
    database.exec('begin')
    const before = database.prepare(`select count(*) as c from ${table}`).get() as { c: number }
    database.exec(`create table if not exists ${rebuilt} (
      country_code text not null, metric_key text not null, period_key text not null,
      scheduled_date text not null, first_scheduled_date text not null, scheduled_at text,
      time_precision text not null check(time_precision in ('minute', 'date')),
      status text not null default 'unknown' check(status in (${releaseStatusMigrationPolicy.statuses.map((status) => `'${status}'`).join(', ')})),
      identity_kind text not null default 'code' check(identity_kind in ('code', 'source')),
      source_label text, series_id text,
      importance text check(importance in ('high', 'medium', 'low')),
      value_state text check(value_state in ('present', 'missing')),
      row_kind text not null default 'release' check(row_kind in ('release', 'estimate')),
      values_json text not null, source_provider_id text not null, source_event_id text not null,
      parser_version text not null, observed_at text not null, first_seen_at text not null,
      first_published_actual text, first_published_previous text,
      primary key(country_code, metric_key, period_key, first_scheduled_date))`)
    database.exec(`insert into ${rebuilt} (${columns.join(', ')}) select ${columns.join(', ')} from ${table}`)
    const copied = database.prepare(`select count(*) as c from ${rebuilt}`).get() as { c: number }
    if (before.c !== copied.c) throw new Error(`row count changed during migration: ${before.c} -> ${copied.c}`)
    database.exec(`create index if not exists idx_calendar_events_month on ${rebuilt}(country_code, scheduled_at)`)
    // 旧表改名留作回滚点；**不 drop**。
    database.exec(`alter table ${table} rename to ${releaseStatusMigrationPolicy.backupTable}`)
    database.exec(`alter table ${rebuilt} rename to ${table}`)
    // RENAME 会把视图里的引用一起改写：必须显式重建，否则视图指向旧表。
    database.exec(`drop view if exists ${calendarStandardTablePolicy.releasesView}`)
    database.exec(`create view ${calendarStandardTablePolicy.releasesView} as
      select * from ${table} where row_kind = 'release'`)
    database.exec('commit')
  } catch (error) {
    try { database.exec('rollback') } catch { /* 保留原始错误 */ }
    throw error
  } finally {
    database.exec('pragma foreign_keys = on')
  }
  const violations = database.prepare('pragma foreign_key_check').all()
  if (violations.length > 0) throw new Error(`foreign_key_check found ${violations.length} violation(s)`)
  return true
}
