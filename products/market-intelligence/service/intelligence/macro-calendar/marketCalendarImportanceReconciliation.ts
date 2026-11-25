import type { DatabaseSync } from 'node:sqlite'

import type { MacroEconomicCalendarImportance } from '../../../contracts/macro/economicCalendarQueryContracts'
import { gradeCalendarEvent } from './calendarEventImportance'
import { calendarStandardTablePolicy } from './marketCalendarStandardTable'

/**
 * **旧档去向的只读核对**（R44 技术方案 §3.1 / §9 S4，Chief 2026-11-24）。
 *
 * 切到读 `importance_grade` 那一刻，旧列里 3000 多行「有档」不再被读——这是口径要的结果
 * （源给的档不算数），但**必须逐族有账**，否则就是一次没人看过的静默降级。
 *
 * 本模块只回答问题，不写库、不回填、不迁移：
 * 1. 旧列有档 → 我们按表**新判**为未分级的（按族计数 + 样本身份）；
 * 2. 旧列有档 → 新判**不同档**的；
 * 3. 旧列 `high` → 新判也是 `high` 的（验证表不是随便写的）。
 *
 * **新判是现算的**，不是读库里那一列：历史行的 `importance_grade` 是 `NULL`（不回填），
 * 拿它比「旧档 vs 新档」等于什么都没比。判据仍是那唯一一个函数。
 */

export type ReconcileBucket = 'graded-now-ungraded' | 'graded-different-tier' | 'high-now-high'

export type ReconcileSample = Readonly<{
  /** `标准行` / `修订行`：同一个身份可能两张表各一行，别混。 */
  table: 'standard' | 'revision'
  countryCode: string
  /** 族：判得出来用判出来的，判不出来用身份里能读到的（修订行 `eventFamily`、码第二段）。 */
  family: string
  legacyTier: MacroEconomicCalendarImportance
  /** 新判的档；`undefined` ＝未分级。 */
  newTier?: MacroEconomicCalendarImportance
  /** 稳定身份，报告里按它指到具体那一行。 */
  identity: string
  basis?: string
}>

export type ReconcileFamilyCount = Readonly<{ family: string; legacyTier: MacroEconomicCalendarImportance; count: number }>

export type CalendarImportanceReconciliation = Readonly<{
  /** 旧列有档、新判未分级（**降级到未分级**——这一桶每一族都要有归属或批准记录）。 */
  gradedNowUngraded: Readonly<{ byFamily: readonly ReconcileFamilyCount[]; rows: readonly ReconcileSample[] }>
  /** 旧列有档、新判不同档（高→中、中→低…）。 */
  gradedDifferentTier: Readonly<{ byFamily: readonly ReconcileFamilyCount[]; rows: readonly ReconcileSample[] }>
  /** 旧列 `high`、新判也 `high`（「本来就没判错」的对照）。 */
  highNowHigh: Readonly<{ byFamily: readonly ReconcileFamilyCount[]; rows: readonly ReconcileSample[] }>
  totals: Readonly<{
    standardRows: number
    revisionRows: number
    legacyGraded: number
    gradedNowUngraded: number
    gradedDifferentTier: number
    highNowHigh: number
  }>
}>

const tierOf = (value: unknown): MacroEconomicCalendarImportance | undefined =>
  value === 'high' || value === 'medium' || value === 'low' ? value : undefined

/**
 * 判不出来时，族仍要有个名字——「逐族有账」不能落在一个 `(unknown)` 上。
 *
 * 三类**必须分开**，因为它们的工作队列也不同：
 * - 四段码但没有登记：族就是码第二段（补一行表）；
 * - `evt.*` 事件键：它没有指标族，属于「事件要不要定档」这一类；
 * - 源内数组身份（`["212058",70663]` 这种）：**还没映射到码**，先补映射表，谈不上定档。
 */
const fallbackFamily = (metricKey: string | undefined, eventFamily: string | undefined): string => {
  if (metricKey === undefined) return eventFamily ?? '(未登记)'
  if (metricKey.startsWith('[')) return '(源内数组身份·未映射到码)'
  if (metricKey.startsWith('evt.')) return '(事件键·无指标族)'
  return metricKey.split('.')[1] ?? '(未登记)'
}

type RawRow = Readonly<{
  table: 'standard' | 'revision'
  countryCode: string
  legacyTier: MacroEconomicCalendarImportance
  legacyFamilyHint?: string
  metricKey?: string
  eventKey?: string
  eventFamily?: string
  identity: string
}>

function standardRows(database: DatabaseSync): RawRow[] {
  // 同上：只读工具**不建表**；标准表不在就 0 行，报告里看得出来。
  if (!tablePresent(database, calendarStandardTablePolicy.eventsTable)) return []
  const rows = database.prepare(`select country_code, metric_key, period_key, first_scheduled_date, importance
    from ${calendarStandardTablePolicy.eventsTable}
    where importance is not null and trim(importance) != ''`).all() as Array<Record<string, unknown>>
  return rows.flatMap((row) => {
    const legacyTier = tierOf(row.importance)
    if (legacyTier === undefined) return []
    const countryCode = String(row.country_code)
    const metricKey = String(row.metric_key)
    return [{
      table: 'standard' as const, countryCode, metricKey, legacyTier,
      identity: `${countryCode}|${metricKey}|${String(row.period_key)}|${String(row.first_scheduled_date)}`
    }]
  })
}

function tablePresent(database: DatabaseSync, table: string): boolean {
  return database.prepare("select name from sqlite_master where type = 'table' and name = ?")
    .get(table) !== undefined
}

function revisionRows(database: DatabaseSync): RawRow[] {
  if (!tablePresent(database, 'mi_macro_calendar_revisions')) return []
  const rows = database.prepare(`select event_key, event_family, country_code, period_key, scheduled_date, importance
    from mi_macro_calendar_revisions
    where importance is not null and trim(importance) != ''`).all() as Array<Record<string, unknown>>
  return rows.flatMap((row) => {
    const legacyTier = tierOf(row.importance)
    if (legacyTier === undefined) return []
    const countryCode = String(row.country_code)
    const eventKey = String(row.event_key)
    const eventFamily = String(row.event_family)
    return [{
      table: 'revision' as const, countryCode, eventKey, eventFamily, legacyTier,
      identity: `${eventKey}|${eventFamily}|${String(row.period_key)}|${String(row.scheduled_date)}`
    }]
  })
}

function judge(row: RawRow): { family: string; newTier?: MacroEconomicCalendarImportance; basis?: string } {
  const verdict = gradeCalendarEvent({
    countryCode: row.countryCode,
    ...(row.metricKey === undefined ? {} : { metricKey: row.metricKey }),
    ...(row.eventKey === undefined ? {} : { eventKey: row.eventKey }),
    ...(row.eventFamily === undefined ? {} : { eventFamily: row.eventFamily })
  })
  if (verdict === undefined) {
    // 未分级：族仍要有个名字，否则「逐族有账」无从谈起。用身份里能读到的那一段，不猜表。
    return { family: fallbackFamily(row.metricKey, row.eventFamily) }
  }
  return { family: verdict.family, newTier: verdict.tier, basis: verdict.basis }
}

function familyCounts(rows: readonly ReconcileSample[]): readonly ReconcileFamilyCount[] {
  const counts = new Map<string, ReconcileFamilyCount>()
  for (const row of rows) {
    const key = `${row.legacyTier}|${row.family}`
    const existing = counts.get(key)
    counts.set(key, { family: row.family, legacyTier: row.legacyTier, count: (existing?.count ?? 0) + 1 })
  }
  return [...counts.values()].sort((left, right) =>
    right.count - left.count || left.family.localeCompare(right.family) ||
    left.legacyTier.localeCompare(right.legacyTier))
}

/**
 * 只读核对：三张单子 + 总数。**同一份库跑两次结果必须一致**（纯读、无时钟、无随机）。
 */
export function reconcileCalendarImportance(database: DatabaseSync): CalendarImportanceReconciliation {
  const standard = standardRows(database)
  const revisions = revisionRows(database)
  const all = [...standard, ...revisions]
  const gradedNowUngraded: ReconcileSample[] = []
  const gradedDifferentTier: ReconcileSample[] = []
  const highNowHigh: ReconcileSample[] = []
  for (const row of all) {
    const verdict = judge(row)
    const sample: ReconcileSample = {
      table: row.table, countryCode: row.countryCode, family: verdict.family,
      legacyTier: row.legacyTier, identity: row.identity,
      ...(verdict.newTier === undefined ? {} : { newTier: verdict.newTier }),
      ...(verdict.basis === undefined ? {} : { basis: verdict.basis })
    }
    if (verdict.newTier === undefined) { gradedNowUngraded.push(sample); continue }
    if (verdict.newTier !== row.legacyTier) { gradedDifferentTier.push(sample); continue }
    if (row.legacyTier === 'high') highNowHigh.push(sample)
  }
  return Object.freeze({
    gradedNowUngraded: Object.freeze({ byFamily: familyCounts(gradedNowUngraded), rows: Object.freeze(gradedNowUngraded) }),
    gradedDifferentTier: Object.freeze({ byFamily: familyCounts(gradedDifferentTier), rows: Object.freeze(gradedDifferentTier) }),
    highNowHigh: Object.freeze({ byFamily: familyCounts(highNowHigh), rows: Object.freeze(highNowHigh) }),
    totals: Object.freeze({
      standardRows: standard.length,
      revisionRows: revisions.length,
      legacyGraded: all.length,
      gradedNowUngraded: gradedNowUngraded.length,
      gradedDifferentTier: gradedDifferentTier.length,
      highNowHigh: highNowHigh.length
    })
  })
}