import type { DatabaseSync } from 'node:sqlite'

import { marketCalendarCodeTable } from './marketCalendarCodeTable'
import { marketCalendarCountryCodeTable } from './marketCalendarCountryCodeTable'
import { calendarStandardTablePolicy } from './marketCalendarStandardTable'
import { sourceIdentityDisplayNames } from './macroCalendarSourceIdentityNames'

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
  /** `metric_key` 槽位里是**事件类型名**（`financial-event` 这类）的行：它不是一个身份。 */
  typeNameIdentities: number
  /**
   * **数组身份行还没有稳定指标 id 的行数**（`series_id` 为空）。
   *
   * 数组身份第一段每次发布都换一个（真库 1943 行对应 1544 个第一段），不能用来登记名字；
   * 稳定的是源自己的 `indicator_id`。这一列为 0 之前，名字登记表再全也查不到这些行。
   */
  sourceIdentitiesWithoutStableId: number
  /**
   * **有稳定 id、但没登记显示名的指标个数**（`series_id` 不在 `sourceIdentityDisplayNames` 里）。
   *
   * 判据只问「这一条登记了没有」，不读名字用了哪些字（不许按措辞判内容）。
   * 数字就是改名表的待办清单长度：登记一个，这个数减一。
   */
  unregisteredSourceNames: number
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

  const registeredIdentityIds = Object.keys(sourceIdentityDisplayNames)
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
    unresolvedPeriodRows: count(`select count(*) as n from ${table} where period_key like 'unknown:%'`),
    /**
     * 类型名不是身份（0.4.5 #15）：写入口已经不再这么写（源内身份行用源自己的 `releaseId`）。
     *
     * **存量行保留、只报不改**（Chief 2026-11-21 定）：身份必须来自源侧事实，而这 3 行的
     * `series_id` 是空的、源身份令牌本身就是用类型名拼的——改它等于我们**编一个身份**。
     * 保留它们是诚实的：行的 `source_label` 仍给出真实名称，读者看得见；等源给出真实 id 再迁。
     * 别把它当脏数据清掉：清掉就是删掉源确实发布过的事实。
     */
    typeNameIdentities: count(`select count(*) as n from ${table}
      where metric_key in ('economic-indicator', 'financial-event', 'central-bank-activity')`),
    // 数组身份还没有稳定 id 的行（0.4.5 #14）：名字登记表按稳定 id 查，这一列不归零就永远查不到。
    sourceIdentitiesWithoutStableId: count(`select count(*) as n from ${table}
      where metric_key like '[%' and (series_id is null or trim(series_id) = '')`),
    // 有稳定 id、但没登记显示名的指标个数：只回答「登记了没有」，不评价名字好坏。
    unregisteredSourceNames: count(`select count(distinct series_id) as n from ${table}
      where metric_key like '[%' and series_id is not null and trim(series_id) <> ''
        ${registeredIdentityIds.length === 0 ? '' : `and series_id not in (${registeredIdentityIds.map(() => '?').join(', ')})`}`,
      ...registeredIdentityIds)
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
  if (counts.typeNameIdentities > 0) gaps.push(`type-name-identity=${counts.typeNameIdentities}`)
  if (counts.sourceIdentitiesWithoutStableId > 0) {
    gaps.push(`source-identities-without-stable-id=${counts.sourceIdentitiesWithoutStableId}`)
  }
  if (counts.unregisteredSourceNames > 0) gaps.push(`unregistered-source-names=${counts.unregisteredSourceNames}`)
  return gaps
}
