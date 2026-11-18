/**
 * **观测表国家码归一（迁移 26）**：把采集端给的别名/三位写法归成两位（Chief 2026-11-18）。
 *
 * 真库实测 168 行：UK 65、JPN 25、FRA 19、CAN 14、ITA 13、AUS 10、CHN 8、SIN 5、PHI 5、INA 3、BEL 1。
 * `EMU` 是唯一允许的非 ISO 两位例外，**不动**。
 *
 * 三条约束：
 * - **幂等**：归一后的码再跑一遍不再匹配，所以「改了几行」天然是 0；
 * - **跑前备份**：第一次写之前整表复制到 `…__country_alias_v26`，只建一次不覆盖；
 * - **按 UTC**：这里不动时间字段，只改国家码。
 *
 * 归一逻辑**只有一份**（`toAlpha2Country`）：这里不写第二套映射表。
 */
import type { DatabaseSync } from 'node:sqlite'

import { toAlpha2Country } from './marketCalendarMetricIdentity'
import { marketCalendarCountryCodeExceptions } from './marketCalendarCountryAliases'

export const observationCountryAliasBackupTable = 'mi_macro_calendar_market_event_observations__country_alias_v26'

export type CountryAliasNormalizationReport = Readonly<{
  scanned: number
  renamed: number
}>

export function normalizeObservationCountryAliases(database: DatabaseSync,
  options?: Readonly<{ dryRun?: boolean }>): CountryAliasNormalizationReport {
  const table = 'mi_macro_calendar_market_event_observations'
  const rows = database.prepare(`select distinct country_code c from ${table}
    where country_code is not null and length(country_code) <> 2`).all() as { c: string }[]
  const plan: { from: string; to: string }[] = []
  for (const row of rows) {
    if (marketCalendarCountryCodeExceptions.includes(row.c)) continue
    const to = toAlpha2Country(row.c)
    // 归不出两位的杂码不猜：留给写入端策略①（跳过 + 记未映射）。
    if (to === row.c || !/^[A-Z]{2}$/.test(to)) continue
    plan.push({ from: row.c, to })
  }
  const scanned = plan.reduce((sum, item) => sum + (database.prepare(
    `select count(*) c from ${table} where country_code = ?`).get(item.from) as { c: number }).c, 0)
  if (options?.dryRun === true || plan.length === 0) return { scanned, renamed: plan.length }

  database.exec(`create table if not exists ${observationCountryAliasBackupTable} as select * from ${table}`)
  const update = database.prepare(`update ${table} set country_code = ? where country_code = ?`)
  let renamed = 0
  database.exec('begin')
  try {
    for (const item of plan) renamed += Number(update.run(item.to, item.from).changes)
    database.exec('commit')
  } catch (error) {
    database.exec('rollback')
    throw error
  }
  return { scanned, renamed }
}
