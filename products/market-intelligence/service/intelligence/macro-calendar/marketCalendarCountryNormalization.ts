import type { DatabaseSync } from 'node:sqlite'

import { calendarStandardTablePolicy } from './marketCalendarStandardTable'
import { toAlpha2Country } from './marketCalendarMetricIdentity'

/**
 * **国家码一次性归一到 alpha-2**（迁移 15，用户 2026-11-16 批）。
 *
 * 现状：标准表里两种写法并存——`US` 与 `USA`（后者 329 行，来自 narwhal / 官方回放 / BLS / BEA / Fed；
 * 0xRouter 的 685 行本来就是两字母，**这次不动它**）。写入端已改为只落 alpha-2，历史这批要单独归一。
 *
 * **主键含 `country_code`**（`country_code, metric_key, period_key, first_scheduled_date`），
 * 所以归一不是改字段，是**迁移**：`US|码|期|首发布日` 与 `USA|码|期|首发布日` 可能同时存在，
 * 必须合并成一行。
 *
 * 四条规矩：
 * 1. **先备份**：整表快照到 `mi_calendar_events__country_v15`（事务内建，回滚时一起消失）；
 * 2. **撞行合并**：保留有 `actual` 的那行、值逐字段合并（空值不覆盖）、`first_published_*` 取先到的；
 * 3. **台账同归一**：`mi_calendar_event_source_ids` 的国家段一起改，否则「按身份匹配」的孤儿判据
 *    会把正常台账判成孤儿；
 * 4. **幂等**：判据是「表里已无需要归一的写法」；迁移标记 15，再跑必须 0 变更。行数对账不等就整笔回滚。
 */
export const calendarCountryNormalizationPolicy = Object.freeze({
  migrationVersion: 15,
  backupTable: 'mi_calendar_events__country_v15'
})

export type CountryNormalizationReport = Readonly<{
  /** 迁移前需要归一的写法（`USA` 这类）行数。 */
  pending: number
  /** 原地改国家的行数（没有撞行的那部分）。 */
  renamed: number
  /** 与已有的 alpha-2 行撞上、合并掉的行数。 */
  merged: number
  /** 台账里被改写的行数。 */
  ledgerRewritten: number
}>

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

const emptyReport = (): CountryNormalizationReport =>
  ({ pending: 0, renamed: 0, merged: 0, ledgerRewritten: 0 })

/**
 * 需要归一的行：**归一后与现值不同**的行，而不是「形状不像两字母」的行。
 *
 * 两个理由：
 * - `UK` 是两字母、形状合格，但它不是合法 alpha-2（那是 `GB`）——按形状筛会漏掉它（真库 16 行）；
 * - 判据要能表达「还有多少行不是规范写法」，形状只是其中一种不合规。
 */
const pendingRows = (database: DatabaseSync, table: string): EventRow[] =>
  (database.prepare(`select * from ${table}`).all() as unknown as EventRow[])
    .filter((row) => toAlpha2Country(row.country_code ?? '') !== (row.country_code ?? ''))

export function normalizeCalendarCountryCodes(database: DatabaseSync): CountryNormalizationReport {
  const table = calendarStandardTablePolicy.eventsTable
  const version = calendarCountryNormalizationPolicy.migrationVersion
  /**
   * **判据是差集，不是版本标记**（用户 2026-11-17，待办 #53 的口径）。
   *
   * 这里原来有一道版本闸：`version 15` 记过就永远返回。于是 v15 跑完之后新进来的行——`FRA 9`、
   * `ITA 6`、`AUS 2`、`USA 1`、`UK 16`、`SIN 2` 那 36 行——**再也不会被归一**，而且没人报错。
   * 国家码归一是「持续补齐」，不是「改写既有旧数据一次」，判据只能是当前还有多少行不合形状。
   */
  const pending = pendingRows(database, table)
  if (pending.length === 0) {
    // 顺手清掉历史标记：留着它，下一个人会以为这条归一还受它控制。
    database.prepare('delete from mi_macro_calendar_migrations where version = ?').run(version)
    return emptyReport()
  }
  const before = Number((database.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n)
  const report = { pending: pending.length, renamed: 0, merged: 0, ledgerRewritten: 0 }
  database.exec('begin')
  try {
    database.exec(`create table if not exists ${calendarCountryNormalizationPolicy.backupTable} as select * from ${table}`)
    const findTarget = database.prepare(`select * from ${table}
      where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ?`)
    // 同一身份可能同时有 `US` 与 `USA` 两行：先按身份分组，避免「先改一个又把另一个改坏」。
    for (const stray of pending) {
      const metricKey = stray.metric_key ?? ''
      const periodKey = stray.period_key ?? ''
      const firstScheduledDate = stray.first_scheduled_date ?? ''
      const target = toAlpha2Country(stray.country_code ?? '')
      // 归一之后仍然不是合法的两字母码（源给了别的东西）：不动它，留给未映射/人工判断，
      // 但**不阻断整笔迁移**——它本来就不能进身份。
      if (!/^[A-Z]{2}$/.test(target)) continue
      const existing = findTarget.get(target, metricKey, periodKey, firstScheduledDate) as EventRow | undefined
      if (existing === undefined) {
        database.prepare(`update ${table} set country_code = ? where country_code = ? and metric_key = ?
          and period_key = ? and first_scheduled_date = ?`)
          .run(target, stray.country_code, metricKey, periodKey, firstScheduledDate)
        report.renamed += 1
      } else {
        const strayWins = !hasActual(existing.values_json ?? '') && hasActual(stray.values_json ?? '')
        const values = JSON.stringify({ ...cleanValues(stray.values_json ?? ''), ...cleanValues(existing.values_json ?? '') })
        database.prepare(`update ${table} set values_json = ?,
            status = case when ? then ? else status end,
            value_state = case when ? then ? else value_state end,
            observed_at = case when ? then ? else observed_at end,
            data_observed_at = case when ? then coalesce(data_observed_at, ?) else data_observed_at end,
            scheduled_at = coalesce(scheduled_at, ?),
            importance = coalesce(importance, ?),
            series_id = coalesce(series_id, ?),
            first_published_actual = coalesce(first_published_actual, ?),
            first_published_previous = coalesce(first_published_previous, ?)
          where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ?`)
          .run(values,
            strayWins ? 1 : 0, stray.status,
            strayWins ? 1 : 0, stray.value_state,
            strayWins ? 1 : 0, stray.observed_at,
            strayWins ? 1 : 0, stray.data_observed_at ?? stray.observed_at,
            stray.scheduled_at, stray.importance, stray.series_id,
            stray.first_published_actual, stray.first_published_previous,
            target, metricKey, periodKey, firstScheduledDate)
        database.prepare(`delete from ${table} where country_code = ? and metric_key = ? and period_key = ?
          and first_scheduled_date = ?`)
          .run(stray.country_code, metricKey, periodKey, firstScheduledDate)
        report.merged += 1
      }
    }
    // 台账同归一：孤儿判据是「按身份匹配」的，所以国家段必须和行保持一致。
    const ledger = database.prepare(`update mi_calendar_event_source_ids set country_code = ? where country_code = ?`)
    for (const code of new Set(pending.map((row) => row.country_code ?? ''))) {
      const target = toAlpha2Country(code)
      if (!/^[A-Z]{2}$/.test(target)) continue
      report.ledgerRewritten += Number(ledger.run(target, code).changes)
    }
    const after = Number((database.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n)
    if (after !== before - report.merged) {
      throw new Error(`country normalization row count mismatch: before=${before} after=${after} merged=${report.merged}`)
    }
    // 不留标记：判据是「还有多少行不合形状」，不是「跑过没有」。
    database.prepare('delete from mi_macro_calendar_migrations where version = ?').run(version)
    database.exec('commit')
    return report
  } catch (error) {
    database.exec('rollback')
    throw error
  }
}
