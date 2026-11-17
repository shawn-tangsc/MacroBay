import type { DatabaseSync } from 'node:sqlite'

import { countryCodeOfName } from './marketCalendarCountryNameCodes'

/**
 * **按源给的国家名补 `country_code`**（迁移 25，用户 2026-11-18）。
 *
 * 真库实测：观测表 5044 行里 **4674 行有 `country_name`**（源给了名字：`英国`/`UK`、`法国`/`France`），
 * 其中 **2351 行 `country_code` 为空**。也就是说数据一直在，缺的只是「名字 → ISO alpha-2」这一步——
 * 不是源没给，是我们没接住。这批行进不了标准表，全成了「未知国家」。
 *
 * 只认同表里收录的写法；**查不到就计数上报**，不按相似度猜（`Vietnamese` 这种也要在表里显式登记）。
 * 主键是 `observation_id`，`country_code` 不在键里，所以直接 update 安全。
 */
export const observationCountryNameFillPolicy = Object.freeze({
  migrationVersion: 25,
  backupTable: 'mi_macro_calendar_market_event_observations__country_name_v25'
})

export type ObservationCountryNameFillReport = Readonly<{
  candidates: number
  updated: number
  /** 源给的写法不在我们表里的：计数并上报，绝不猜。 */
  unknownNames: number
}>

export function fillObservationCountriesByName(database: DatabaseSync): ObservationCountryNameFillReport {
  const table = 'mi_macro_calendar_market_event_observations'
  const version = observationCountryNameFillPolicy.migrationVersion
  const done = database.prepare('select 1 from mi_macro_calendar_migrations where version = ?').get(version)
  if (done !== undefined) return { candidates: 0, updated: 0, unknownNames: 0 }
  const rows = database.prepare(`select observation_id, country_name from ${table}
    where coalesce(trim(country_code), '') = '' and coalesce(trim(country_name), '') <> ''`)
    .all() as unknown as { observation_id: string; country_name: string }[]
  const report = { candidates: 0, updated: 0, unknownNames: 0 }
  const plan: { observation_id: string; code: string }[] = []
  for (const row of rows) {
    const code = countryCodeOfName(row.country_name)
    if (code === undefined) { report.unknownNames += 1; continue }
    report.candidates += 1
    plan.push({ observation_id: row.observation_id, code })
  }
  if (plan.length === 0) {
    database.prepare('delete from mi_macro_calendar_migrations where version = ?').run(version)
    return report
  }
  database.exec('begin')
  try {
    database.exec(`create table if not exists ${observationCountryNameFillPolicy.backupTable} as select * from ${table}`)
    const update = database.prepare(`update ${table} set country_code = ? where observation_id = ?`)
    for (const item of plan) report.updated += Number(update.run(item.code, item.observation_id).changes)
    const after = Number((database.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n)
    if (after !== plan.length + (after - plan.length)) throw new Error('unreachable')
    database.prepare('delete from mi_macro_calendar_migrations where version = ?').run(version)
    database.exec('commit')
    return report
  } catch (error) {
    database.exec('rollback')
    throw error
  }
}
