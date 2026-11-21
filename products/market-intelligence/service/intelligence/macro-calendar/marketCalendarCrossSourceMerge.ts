import type { DatabaseSync } from 'node:sqlite'

import { calendarStandardTablePolicy } from './marketCalendarStandardTable'

/**
 * **跨源同名合并**（迁移 17，用户 2026-11-16 批，方案见
 * `macro-calendar-cross-source-dedup-plan.md`）。
 *
 * 起因：主键含 `first_scheduled_date`，两个来源对**同一次发布**的排期看法不同就存成两行
 * （实测 12 组跨来源 + 8 组同来源）。一次发布是事实，两个数据商各报一份不该变成两次发布；
 * 但**同一来源同期内的多次真实发布**（BEA 二读/三读）必须留着。
 *
 * 合并规则（Chief 定）：
 * - 合并键＝归一后的「国家 + 指标 + 期次」，**不按源内 id、不按标题**；
 * - **值冲突就不合**：两个来源都有 `actual` 且不同（失业率 4.1 / 4.2 那组）→ **两条都保留**，
 *   只记次数；时间戳不做裁判（跨来源里「更晚」不代表更权威）；
 * - 逐字段取非空；冲突字段才按来源优先级（官方 > 市场）；
 * - `first_scheduled_date` 取更早的；**展示排期取官方排期**，没有官方行时取有值那一行的排期；
 * - 台账两个 `source_event_id` 都留（主键是 provider+id，天然两条），身份列跟着改到合并后的行；
 * - 备份整表、单事务、行数对账、二次运行 0 变更、**不 drop 旧表**（改名留作回滚点）。
 *
 * **判据是当前缺口，不是「跑过一次」**（2026-11-21）：这条原来用迁移版本 17 闸住，跑过一次就
 * 永远短路。但写入端**还能继续产生这种形状**——标准表主键含 `first_scheduled_date`，而写入端只
 * 在**同一来源**内认回身份（`marketCalendarSameIdentityWrite.ts` 按 `source_provider_id` 查），
 * 两家来源对同一次发布的「首次排期」看法不同就是两行（改期、补排都会出现）。标记在、缺口在，
 * 两边看起来都正常。所以改成每次启动算一次当前重复组，为 0 就跳过。
 */
export const calendarCrossSourceMergePolicy = Object.freeze({
  migrationVersion: 17,
  backupTable: 'mi_calendar_events__xsource_v17',
  officialProviders: ['macro-calendar-bls', 'macro-calendar-bea', 'macro-calendar-fed'] as const
})

export type CrossSourceMergeReport = Readonly<{
  /** 参与判定的重复组数。 */
  groups: number
  /** 合并掉的组数与行数。 */
  mergedGroups: number
  removedRows: number
  /** 因值冲突而保留两行的组数（记次数、不合并）。 */
  conflictedGroups: number
  /** 写入 `release_count` 的行数。 */
  releaseCountRows: number
}>

type Row = Record<string, string | number | null>

const emptyReport = (): CrossSourceMergeReport =>
  ({ groups: 0, mergedGroups: 0, removedRows: 0, conflictedGroups: 0, releaseCountRows: 0 })

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

const actualOf = (json: string): string | undefined => cleanValues(json).actual

const isOfficial = (providerId: string): boolean =>
  (calendarCrossSourceMergePolicy.officialProviders as readonly string[]).includes(providerId)

export function mergeCrossSourceCalendarRows(database: DatabaseSync): CrossSourceMergeReport {
  const table = calendarStandardTablePolicy.eventsTable
  const version = calendarCrossSourceMergePolicy.migrationVersion
  // 老库留下的标记同时清掉：留着会让下一个人以为这条还受版本闸控制。
  // 迁移表可能不存在（启动链那段 `try` 里踩过这个坑：缺表直接抛，后面的步骤一条都不跑）——
  // 清理标记是附带动作，缺表不是错误。
  if (database.prepare("select 1 from sqlite_master where type = 'table' and name = 'mi_macro_calendar_migrations'").get() !== undefined) {
    database.prepare('delete from mi_macro_calendar_migrations where version = ?').run(version)
  }
  const groups = database.prepare(`select country_code, metric_key, period_key, count(*) as n
    from ${table} where row_kind = 'release'
    group by country_code, metric_key, period_key having n > 1`).all() as unknown as
    { country_code: string; metric_key: string; period_key: string; n: number }[]
  const report = { ...emptyReport(), groups: groups.length }
  if (groups.length === 0) return report
  const before = Number((database.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n)
  database.exec('begin')
  try {
    database.exec(`create table if not exists ${calendarCrossSourceMergePolicy.backupTable} as select * from ${table}`)
    const rowsOf = database.prepare(`select * from ${table}
      where country_code = ? and metric_key = ? and period_key = ? order by first_scheduled_date asc`)
    const deleteRow = database.prepare(`delete from ${table}
      where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ?`)
    const setReleaseCount = database.prepare(`update ${table} set release_count = ?, release_dates_json = ?
      where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ?`)
    const repointLedger = database.prepare(`update mi_calendar_event_source_ids
      set first_scheduled_date = ? where country_code = ? and metric_key = ? and period_key = ?
        and first_scheduled_date = ?`)
    for (const group of groups) {
      const rows = rowsOf.all(group.country_code, group.metric_key, group.period_key) as unknown as Row[]
      if (rows.length < 2) continue
      const providers = new Set(rows.map((row) => String(row.source_provider_id)))
      const isCrossSource = providers.size > 1
      const actuals = rows.map((row) => actualOf(String(row.values_json ?? ''))).filter((value): value is string => value !== undefined)
      // **值冲突不合并**：两个来源对同一期给出不同的 actual（失业率 4.1/4.2）——两条都留，
      // 时间戳不做裁判。同来源那条（GDP 二读/三读、周报挤期）也走这条，天然不合并。
      const distinct = new Set(actuals)
      const conflict = distinct.size > 1
      // **同来源默认不合并**：同源同期的多行可能是二读/三读（GDP 那组两条都是 scheduled、
      // 没有 actual，谁也证明不了它们是同一件事）。只有「两行都有 actual 且完全相同」才认作
      // 同一份事实被写两次（ISM/密歇根/红皮书那三组），其余一律保留。
      const sameSourceDuplicate = !isCrossSource && actuals.length >= 2 && distinct.size === 1
      if (!isCrossSource && !sameSourceDuplicate) {
        for (const row of rows) {
          setReleaseCount.run(rows.length, JSON.stringify(rows.map((item) => String(item.scheduled_date)).sort()),
            group.country_code, group.metric_key, group.period_key, String(row.first_scheduled_date))
          report.releaseCountRows += 1
        }
        continue
      }
      if (isCrossSource && conflict) {
        report.conflictedGroups += 1
        for (const row of rows) {
          setReleaseCount.run(rows.length, JSON.stringify(rows.map((item) => String(item.scheduled_date)).sort()),
            group.country_code, group.metric_key, group.period_key, String(row.first_scheduled_date))
          report.releaseCountRows += 1
        }
        continue
      }
      // 合并：官方行优先做底，否则取有值那行，再否则取最早行。
      const base = rows.find((row) => isOfficial(String(row.source_provider_id)))
        ?? rows.find((row) => actualOf(String(row.values_json ?? '')) !== undefined) ?? rows[0]!
      const values: Record<string, string> = {}
      for (const row of rows) Object.assign(values, cleanValues(String(row.values_json ?? '')))
      const firstScheduledDate = String(rows[0]!.first_scheduled_date)
      const importance = rows.map((row) => row.importance).find((value) => value !== null) ?? null
      const eventType = rows.map((row) => row.event_type).find((value) => value !== null) ?? null
      database.prepare(`update ${table} set values_json = ?, status = ?, value_state = ?, importance = coalesce(importance, ?),
          event_type = coalesce(event_type, ?), release_count = ?, release_dates_json = ?, first_scheduled_date = ?,
          scheduled_date = ?, scheduled_at = ?, time_precision = ?
        where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ?`)
        .run(JSON.stringify(values), base.status, base.value_state, importance, eventType, rows.length,
          // 每一次排期：合并前那几行的 `scheduled_date`（排序后原样存，不编时刻）。
          JSON.stringify(rows.map((row) => String(row.scheduled_date)).sort()),
          firstScheduledDate, base.scheduled_date, base.scheduled_at, base.time_precision,
          group.country_code, group.metric_key, group.period_key, String(base.first_scheduled_date))
      report.releaseCountRows += 1
      // 台账两家的 id 都留：身份列跟到合并后的首个排期，行上只保留一个 id。
      for (const row of rows) {
        if (String(row.first_scheduled_date) === firstScheduledDate) continue
        repointLedger.run(firstScheduledDate, group.country_code, group.metric_key, group.period_key, String(row.first_scheduled_date))
      }
      for (const row of rows) {
        if (String(row.first_scheduled_date) === String(base.first_scheduled_date)) continue
        deleteRow.run(group.country_code, group.metric_key, group.period_key, String(row.first_scheduled_date))
        report.removedRows += 1
      }
      report.mergedGroups += 1
    }
    const after = Number((database.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n)
    if (after !== before - report.removedRows) {
      throw new Error(`cross-source merge row count mismatch: before=${before} after=${after} removed=${report.removedRows}`)
    }
    database.exec('commit')
    return report
  } catch (error) {
    database.exec('rollback')
    throw error
  }
}
