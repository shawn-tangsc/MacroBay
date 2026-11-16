import type { DatabaseSync } from 'node:sqlite'

import { periodFromSourceTitle } from './marketCalendarSourcePeriodFromTitle'
import { calendarStandardTablePolicy } from './marketCalendarStandardTable'

/**
 * **期次归一（迁移 21）**：数组身份行的 `period_key` 从「发布时刻」改成**源标题里的统计期**
 * （用户 2026-11-17 定，方案 A）。
 *
 * 此前 0xrouter 行把发布时刻写成期次（`2026-11-16T13:30`），于是「按期次比较」全是假判断：
 * 消费信贷 `(Sep)` 那条真期次是 `2026-09`，却被记成 `2026-10`，看起来像跨月。
 *
 * 三条规则：
 * - 标题能解出期次 → 写解析值；解不出 → **`unknown:<source_event_id>`**（每行唯一、语义是明确缺失）；
 *   **绝不写裸 `unknown`**：主键是四项，同期次的缺失行会互相合并、静默丢一条（架构师那条坑）；
 * - 归一后撞行（同国家 + 指标码 + 期次 + 首发布日）→ 合并：留**有值**的那行，值不同按数据观测时刻
 *   新者为准（与标准表「旧数据不许盖新数据」同一条）；**被合并掉的行原文单独存表**，事后能查；
 * - 备份整表、单事务、行数对账（368 → 366）、二次运行 0 变更。
 */
export const calendarSourcePeriodPolicy = Object.freeze({
  migrationVersion: 21,
  backupTable: 'mi_calendar_events__period_v21',
  droppedTable: 'mi_calendar_events__period_merge_dropped_v21'
})

export type SourcePeriodMigrationReport = Readonly<{
  scanned: number
  rewritten: number
  unknown: number
  mergedGroups: number
  droppedRows: number
}>

export function normalizeSourcePeriods(database: DatabaseSync): SourcePeriodMigrationReport {
  const table = calendarStandardTablePolicy.eventsTable
  const version = calendarSourcePeriodPolicy.migrationVersion
  const done = database.prepare('select 1 from mi_macro_calendar_migrations where version = ?').get(version)
  if (done !== undefined) return { scanned: 0, rewritten: 0, unknown: 0, mergedGroups: 0, droppedRows: 0 }
  const rows = database.prepare(`select country_code, metric_key, period_key, scheduled_date, first_scheduled_date,
      source_event_id, source_label, source_label_en, values_json, status, value_state, observed_at
    from ${table} where metric_key like '[%'`).all() as unknown as Record<string, unknown>[]
  const report = { scanned: rows.length, rewritten: 0, unknown: 0, mergedGroups: 0, droppedRows: 0 }
  const before = Number((database.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n)
  database.exec('begin')
  try {
    database.exec(`create table if not exists ${calendarSourcePeriodPolicy.backupTable} as select * from ${table}`)
    database.exec(`create table if not exists ${calendarSourcePeriodPolicy.droppedTable} as
      select * from ${table} where 0`)
    // **先分组、后写库**：主键含 `period_key`，若逐行直接改，先改的那行会撞上还没改的那行。
    // 所以顺序是：① 全部删掉被合并的行（原文先落 dropped 表）→ ② 再把留下的行改成最终期次。
    const groups = new Map<string, Record<string, unknown>[]>()
    for (const row of rows) {
      const derived = periodFromSourceTitle(String(row.source_label_en ?? row.source_label ?? ''), String(row.scheduled_date))
      const periodKey = derived === null ? `unknown:${String(row.source_event_id)}` : derived.periodKey
      if (derived === null) report.unknown += 1
      if (periodKey !== String(row.period_key)) report.rewritten += 1
      const key = `${String(row.country_code)}|${String(row.metric_key)}|${periodKey}|${String(row.first_scheduled_date)}`
      groups.set(key, [...(groups.get(key) ?? []), { ...row, finalPeriod: periodKey }])
    }
    const hasValue = (row: Record<string, unknown>): boolean => {
      try { return Object.keys(JSON.parse(String(row.values_json ?? '{}'))).length > 0 } catch { return false }
    }
    const drop = database.prepare(`delete from ${table}
      where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ?`)
    const keep = new Map<string, Record<string, unknown>>()
    for (const [key, group] of groups) {
      const ranked = [...group].sort((left, right) => {
        const byValue = Number(hasValue(right)) - Number(hasValue(left))
        if (byValue !== 0) return byValue
        return String(right.observed_at).localeCompare(String(left.observed_at))
      })
      const winner = ranked[0]!
      keep.set(key, winner)
      if (ranked.length < 2) continue
      report.mergedGroups += 1
      for (const loser of ranked.slice(1)) {
        // **被合并掉的行原文单独留一份**：合并后要能查「本来有两条什么」。
        database.prepare(`insert into ${calendarSourcePeriodPolicy.droppedTable}
          select * from ${calendarSourcePeriodPolicy.backupTable}
          where country_code = ? and metric_key = ? and first_scheduled_date = ? and source_event_id = ? limit 1`)
          .run(String(loser.country_code), String(loser.metric_key), String(loser.first_scheduled_date),
            String(loser.source_event_id))
        drop.run(String(loser.country_code), String(loser.metric_key), String(loser.period_key),
          String(loser.first_scheduled_date))
        report.droppedRows += 1
      }
    }
    const rewrite = database.prepare(`update ${table} set period_key = ?
      where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ?`)
    for (const winner of keep.values()) {
      if (String(winner.finalPeriod) === String(winner.period_key)) continue
      rewrite.run(String(winner.finalPeriod), String(winner.country_code), String(winner.metric_key),
        String(winner.period_key), String(winner.first_scheduled_date))
    }
    const after = Number((database.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n)
    if (after !== before - report.droppedRows) {
      throw new Error(`period normalize row count mismatch: before=${before} after=${after} dropped=${report.droppedRows}`)
    }
    database.prepare('insert or ignore into mi_macro_calendar_migrations(version) values (?)').run(version)
    database.exec('commit')
    return report
  } catch (error) {
    database.exec('rollback')
    throw error
  }
}
