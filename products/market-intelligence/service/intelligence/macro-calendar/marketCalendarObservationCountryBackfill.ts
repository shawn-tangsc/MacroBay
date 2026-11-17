import type { DatabaseSync } from 'node:sqlite'

/**
 * **按 `indicatorId` 补观测的国家**（迁移 24，用户 2026-11-17 定）。
 *
 * 依据是事实、不是猜测：**同一个 `indicatorId` 就是同一个序列**，它在别的观测里带过国家，这一条就该是
 * 那个国家。真库实测：2676 条观测没有国家，其中 **325 条**能按这条补上（对应 54 个 id），
 * 2114 条对应的 id 在**所有**观测里都没出现过国家——那批只能是「源未给」，不许编。
 *
 * 观测表的主键是 `observation_id`，`country_code` 不是键的一部分，所以这里可以**直接 update**，
 * 不需要期次/国家归一那套「先删后改」的两阶段（那个绕法只为躲开主键冲突）。
 */
export const observationCountryBackfillPolicy = Object.freeze({
  migrationVersion: 24,
  backupTable: 'mi_macro_calendar_market_event_observations__country_v24'
})

export type ObservationCountryBackfillReport = Readonly<{
  /** 能补的观测条数。 */
  candidates: number
  /** 实际写入的条数。 */
  updated: number
  /** 对应多少个 indicatorId。 */
  indicatorIds: number
  /** 补不了的（该 id 在所有观测里都没国家）。 */
  unresolvable: number
}>

export function backfillObservationCountries(database: DatabaseSync): ObservationCountryBackfillReport {
  const table = 'mi_macro_calendar_market_event_observations'
  const version = observationCountryBackfillPolicy.migrationVersion
  const done = database.prepare('select 1 from mi_macro_calendar_migrations where version = ?').get(version)
  if (done !== undefined) return { candidates: 0, updated: 0, indicatorIds: 0, unresolvable: 0 }
  const rows = database.prepare(`select observation_id, indicator_id from ${table}
    where coalesce(trim(country_code), '') = '' and indicator_id is not null and trim(indicator_id) <> ''`)
    .all() as unknown as { observation_id: string; indicator_id: string }[]
  const countryOf = database.prepare(`select country_code from ${table}
    where indicator_id = ? and coalesce(trim(country_code), '') <> '' limit 1`)
  // 每个 id 在整份观测里必须**只有一个**国家，才敢补：出现两个国家说明这个 id 跨了国家，补哪个都是猜。
  const countriesOf = database.prepare(`select distinct country_code from ${table}
    where indicator_id = ? and coalesce(trim(country_code), '') <> ''`)
  const report = { candidates: 0, updated: 0, indicatorIds: 0, unresolvable: 0 }
  const seen = new Set<string>()
  const plan: { observation_id: string; country: string }[] = []
  for (const row of rows) {
    const countries = (countriesOf.all(row.indicator_id) as unknown as { country_code: string }[])
      .map((entry) => entry.country_code.trim())
    if (countries.length === 0) { report.unresolvable += 1; continue }
    if (countries.length > 1) { report.unresolvable += 1; continue }
    const country = countries[0]!
    report.candidates += 1
    seen.add(row.indicator_id)
    plan.push({ observation_id: row.observation_id, country })
  }
  report.indicatorIds = seen.size
  if (plan.length === 0) {
    database.prepare('delete from mi_macro_calendar_migrations where version = ?').run(version)
    return report
  }
  database.exec('begin')
  try {
    database.exec(`create table if not exists ${observationCountryBackfillPolicy.backupTable} as select * from ${table}`)
    const update = database.prepare(`update ${table} set country_code = ? where observation_id = ?`)
    for (const item of plan) report.updated += Number(update.run(item.country, item.observation_id).changes)
    // 只改一列非键值：行数必须守恒。
    const rowsAfter = Number((database.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n)
    const rowsBefore = Number((database.prepare(`select count(*) as n from ${observationCountryBackfillPolicy.backupTable}`)
      .get() as { n: number }).n)
    if (rowsAfter !== rowsBefore) {
      throw new Error(`country backfill changed row count: before=${rowsBefore} after=${rowsAfter}`)
    }
    database.prepare('delete from mi_macro_calendar_migrations where version = ?').run(version)
    database.exec('commit')
    return report
  } catch (error) {
    database.exec('rollback')
    throw error
  }
}
