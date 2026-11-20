import type { DatabaseSync } from 'node:sqlite'

import { calendarStandardTablePolicy } from './marketCalendarStandardTable'
import { isMPeriodKey, normalizeCalendarPeriodKey, normalizeCalendarSourceEventId } from './marketCalendarPeriodKey'

/**
 * **把历史上写歪的 `YYYY-MNN` 期次并回 `YYYY-MM`**（迁移 14）。
 *
 * 来源：官方回放（`macro-calendar-official-replay`）早期按 BLS 的参考期写法原样落库，
 * 于是同一期在标准表里有两行——`US.CPI.NSA.YOY | 2026-10` 与 `US.CPI.NSA.YOY | 2026-M10`，
 * 同一天、同一次发布。主键是「身份 + 首发布日」，两种写法把它绕过去了。
 *
 * 四条规矩（Chief 2026-11-16）：
 * 1. **不删数据、走合并**：同指标同首发布日的两行合成一行，**有值的留下**，
 *    `first_published_*` 取先到的那个；
 * 2. **合并前备份**：整表快照到 `mi_calendar_events__period_merge_v14`，事务内建、跨启动保留；
 * 3. **幂等**：迁移标记 + 没有 `Y-MNN` 行就直接返回；跑两遍第二遍全 0；
 * 4. **行数对账**：合并后行数必须等于「合并前 − 合并掉的条数」，不等就整笔回滚。
 *
 * 台账（`mi_calendar_event_source_ids`）跟着改：期次归一、来源 id 归一；会与已有台账行撞主键的
 * 那条先删（同一发布在台账里只该有一条）。
 */
export const calendarPeriodKeyMergePolicy = Object.freeze({
  migrationVersion: 14,
  backupTable: 'mi_calendar_events__period_merge_v14'
})

export type PeriodKeyMergeReport = Readonly<{ renamed: number; merged: number; ledgerRewritten: number; ledgerDropped: number }>

type EventRow = Record<string, string | null>

const cleanValues = (json: string): Record<string, string> => {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'string' || value.trim() === '') continue
      out[key] = value
    }
    return out
  } catch { return {} }
}

const hasActual = (json: string): boolean => cleanValues(json).actual !== undefined

const emptyReport = (): PeriodKeyMergeReport => ({ renamed: 0, merged: 0, ledgerRewritten: 0, ledgerDropped: 0 })

export function mergeMPeriodStandardRows(database: DatabaseSync): PeriodKeyMergeReport {
  const table = calendarStandardTablePolicy.eventsTable
  const done = database.prepare('select 1 from mi_macro_calendar_migrations where version = ?')
    .get(calendarPeriodKeyMergePolicy.migrationVersion)
  if (done !== undefined) return emptyReport()
  const strays = database.prepare(`select * from ${table} where period_key glob '*-M[0-9][0-9]'`).all() as unknown as EventRow[]
  if (strays.length === 0) {
    database.prepare('insert or ignore into mi_macro_calendar_migrations(version) values (?)')
      .run(calendarPeriodKeyMergePolicy.migrationVersion)
    return emptyReport()
  }
  const before = Number((database.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n)
  const report = { renamed: 0, merged: 0, ledgerRewritten: 0, ledgerDropped: 0 }
  database.exec('begin')
  try {
    // ② 备份：整表快照（事务内建表，回滚时连表一起消失）。
    database.exec(`create table if not exists ${calendarPeriodKeyMergePolicy.backupTable} as select * from ${table}`)
    const findTarget = database.prepare(`select * from ${table}
      where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ?`)
    const ledgerFor = database.prepare(`select 1 from mi_calendar_event_source_ids
      where provider_id = ? and source_event_id = ?`)
    for (const stray of strays) {
      const countryCode = stray.country_code ?? ''
      const metricKey = stray.metric_key ?? ''
      const periodKey = stray.period_key ?? ''
      const firstScheduledDate = stray.first_scheduled_date ?? ''
      if (!isMPeriodKey(periodKey)) continue
      const target = normalizeCalendarPeriodKey(periodKey)
      const existing = findTarget.get(countryCode, metricKey, target, firstScheduledDate) as EventRow | undefined
      if (existing === undefined) {
        // 没有对方：原地改期次即可（不是删行）。
        database.prepare(`update ${table} set period_key = ? where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ?`)
          .run(target, countryCode, metricKey, periodKey, firstScheduledDate)
        report.renamed += 1
      } else {
        // 有一对：合到既有那行上。**有值的留下**：两边都认「有没有 actual」。
        const strayWins = !hasActual(existing.values_json ?? '') && hasActual(stray.values_json ?? '')
        const values = JSON.stringify({ ...cleanValues(stray.values_json ?? ''), ...cleanValues(existing.values_json ?? '') })
        database.prepare(`update ${table} set values_json = ?,
            status = case when ? then ? else status end,
            value_state = case when ? then ? else value_state end,
            observed_at = case when ? then ? else observed_at end,
            scheduled_at = coalesce(scheduled_at, ?),
            time_precision = case when scheduled_at is null then ? else time_precision end,
            importance = coalesce(importance, ?),
            series_id = coalesce(series_id, ?),
            first_published_actual = coalesce(first_published_actual, ?),
            first_published_previous = coalesce(first_published_previous, ?)
          where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ?`)
          .run(values,
            strayWins ? 1 : 0, stray.status,
            strayWins ? 1 : 0, stray.value_state,
            strayWins ? 1 : 0, stray.observed_at,
            stray.scheduled_at, stray.time_precision,
            stray.importance, stray.series_id,
            stray.first_published_actual, stray.first_published_previous,
            countryCode, metricKey, target, firstScheduledDate)
        database.prepare(`delete from ${table} where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ?`)
          .run(countryCode, metricKey, periodKey, firstScheduledDate)
        report.merged += 1
      }
      // 台账跟着走：撞主键的那条先删，其余把期次与来源 id 归一到留下的那行。
      const normalizedId = normalizeCalendarSourceEventId(stray.source_event_id ?? '')
      if (ledgerFor.get(stray.source_provider_id ?? '', normalizedId) !== undefined) {
        const dropped = database.prepare(`delete from mi_calendar_event_source_ids where provider_id = ? and source_event_id = ?`)
          .run(stray.source_provider_id ?? '', stray.source_event_id ?? '')
        report.ledgerDropped += Number(dropped.changes)
      } else {
        const rewritten = database.prepare(`update mi_calendar_event_source_ids set period_key = ?, source_event_id = ?
          where provider_id = ? and source_event_id = ?`)
          .run(target, normalizedId, stray.source_provider_id ?? '', stray.source_event_id ?? '')
        report.ledgerRewritten += Number(rewritten.changes)
      }
    }
    // ④ 行数对账：删掉的只有被合并的那些。
    const after = Number((database.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n)
    if (after !== before - report.merged) {
      throw new Error(`period-key merge row count mismatch: before=${before} after=${after} merged=${report.merged}`)
    }
    database.prepare('insert or ignore into mi_macro_calendar_migrations(version) values (?)')
      .run(calendarPeriodKeyMergePolicy.migrationVersion)
    database.exec('commit')
    return report
  } catch (error) {
    database.exec('rollback')
    throw error
  }
}
