import type { DatabaseSync } from 'node:sqlite'

import { marketCalendarCodeTable } from './marketCalendarCodeTable'
import { marketCalendarCountryCodeTable } from './marketCalendarCountryCodeTable'
import { calendarStandardTablePolicy } from './marketCalendarStandardTable'

/**
 * **日历数据一致性盘点**（用户 2026-11-19 定）：五项扫描做成一条可复用的只读检查。
 *
 * 这五项是这几轮清库真正用过的判据，任何一项不为 0 就说明数据又开始往回长：
 * ① `value_state='present'` 但 `values_json` 没有非空 `actual`——「标着有值其实没数」；
 * ② `value_state='missing'` 但有非空 `actual`——「标着没值其实有数」；
 * ③ 按（国家 + 码 + 期次）重复的多行——同一次发布落了两次；
 * ④ 一二级码「发布日已过 + 无实际值 + 没写缺值原因」——该有值却没有；
 * ⑤ `period_key` 仍是 `unknown:`——期次没解开。
 *
 * **只读、零网络**：启动盘点与巡检都调它，读不到就抛给调用方吞掉（启动不许因盘点失败而起不来）。
 * 判据「一二级」用码表的 `status='active' && tier∈{1,2}`（与清库时那批脚本同一条口径），
 * 不用 `importance`——那是每次发布的重要度，不是码的分级。
 */
export type CalendarIntegrityCounts = Readonly<{
  presentWithoutActual: number
  missingWithActual: number
  duplicateGroups: number
  duplicateRows: number
  tierOverdueWithoutValueOrReason: number
  unresolvedPeriodRows: number
}>

const activeTierCodes = (): readonly string[] => {
  const rows = [...new Map([...Object.values(marketCalendarCodeTable),
    ...Object.values(marketCalendarCountryCodeTable)].map((row) => [row.code, row])).values()]
  return rows.filter((row) => row.status === 'active' && (row.tier === 1 || row.tier === 2)).map((row) => row.code)
}

/** 判「有没有非空 actual」的 SQL 片段：空串与 null 都算没值（与 `hasActualValue` 同一条口径）。 */
const hasActualSql = `(json_valid(values_json) and coalesce(json_extract(values_json,'$.actual'),'') <> '')`

export function auditCalendarIntegrity(
  database: DatabaseSync,
  options: Readonly<{ today: string }>
): CalendarIntegrityCounts {
  const table = calendarStandardTablePolicy.eventsTable
  const count = (sql: string, ...params: readonly string[]): number =>
    Number((database.prepare(sql).get(...(params as never[])) as { n: number }).n)

  const codes = activeTierCodes()
  const codePlaceholders = codes.map(() => '?').join(', ')

  const duplicateGroups = count(`select count(*) as n from (
    select 1 from ${table} group by country_code, metric_key, period_key having count(*) > 1)`)
  const duplicateRows = count(`select coalesce(sum(n), 0) as n from (
    select count(*) as n from ${table} group by country_code, metric_key, period_key having count(*) > 1)`)

  return {
    presentWithoutActual: count(`select count(*) as n from ${table}
      where value_state = 'present' and not ${hasActualSql}`),
    missingWithActual: count(`select count(*) as n from ${table}
      where value_state = 'missing' and ${hasActualSql}`),
    duplicateGroups,
    duplicateRows,
    tierOverdueWithoutValueOrReason: codes.length === 0 ? 0 : count(`select count(*) as n from ${table}
      where metric_key in (${codePlaceholders})
        and first_scheduled_date < ?
        and not ${hasActualSql}
        and coalesce(missing_reason, '') = ''`, ...codes, options.today),
    unresolvedPeriodRows: count(`select count(*) as n from ${table} where period_key like 'unknown:%'`)
  }
}

/** 五项里有没有不为 0 的：巡检只在有缺口时报，避免每天刷一行「都正常」。 */
export function calendarIntegrityGaps(counts: CalendarIntegrityCounts): readonly string[] {
  const gaps: string[] = []
  if (counts.presentWithoutActual > 0) gaps.push(`present-without-actual=${counts.presentWithoutActual}`)
  if (counts.missingWithActual > 0) gaps.push(`missing-with-actual=${counts.missingWithActual}`)
  if (counts.duplicateGroups > 0) gaps.push(`duplicate-groups=${counts.duplicateGroups}`)
  if (counts.tierOverdueWithoutValueOrReason > 0) {
    gaps.push(`tier-overdue=${counts.tierOverdueWithoutValueOrReason}`)
  }
  if (counts.unresolvedPeriodRows > 0) gaps.push(`unresolved-period=${counts.unresolvedPeriodRows}`)
  return gaps
}
