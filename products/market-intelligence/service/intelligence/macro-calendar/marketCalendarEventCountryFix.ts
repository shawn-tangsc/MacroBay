import type { DatabaseSync } from 'node:sqlite'

import { calendarStandardTablePolicy } from './marketCalendarStandardTable'

/**
 * **事件行的国家值修正**（迁移 19，用户 2026-11-17 批）。
 *
 * 起因：事件型行的国家是源按「在哪讲/谁的场子」硬塞的，双向都错——`纽约联储主席威廉姆斯讲话`
 * 挂在 DE 下，`拉加德/连恩讲话` 挂在 US 下。国家**按机构归属**，不按开会地点（15 号文档 §八）。
 *
 * 口径（产品经理定，Chief 采纳）：
 * - 欧洲央行的事件与讲话 → `EMU`（**不是 `EU`**：`EU` 含非欧元国，混用会让「欧元区 CPI」与
 *   「欧盟 CPI」撞成一个身份）；
 * - 美联储的事件与讲话 → `USA`（威廉姆斯在欧洲央行会议上讲，仍是 `USA`）；
 * - G7 外长会 → `GLOBAL`（无单一主办机构）；欧洲财金领导人年会 → `EMU`（欧元区财长层面，有机构）；
 * - 公司事件（英伟达 GTC）**不进标准日历**，留给事件类型那笔处理，这里不动它。
 *
 * 只改**已经错的那几行**：不动指标行（它们有发布机构，国家是对的）。
 * 备份整表、单事务、行数对账（这里只改国家值，行数必须守恒）、迁移版本幂等。
 */
export const calendarEventCountryFixPolicy = Object.freeze({
  migrationVersion: 19,
  backupTable: 'mi_calendar_events__country_fix_v19'
})

/** 源内 id（数组身份第一段）→ 正确国家码。只列核过的，不猜。 */
export const eventCountryFixes: Readonly<Record<string, string>> = Object.freeze({
  // 美联储的讲话挂在 DE 下：按机构归美国
  '45051': 'USA',
  // 欧洲央行三位（首席经济学家连恩 ×2、行长拉加德）挂在 US 下：按机构归欧元区
  '45023': 'EMU',
  '45138': 'EMU',
  '45145': 'EMU'
})

export type EventCountryFixReport = Readonly<{ scanned: number; updated: number }>

export function fixCalendarEventCountries(database: DatabaseSync): EventCountryFixReport {
  const table = calendarStandardTablePolicy.eventsTable
  const version = calendarEventCountryFixPolicy.migrationVersion
  const done = database.prepare('select 1 from mi_macro_calendar_migrations where version = ?').get(version)
  if (done !== undefined) return { scanned: 0, updated: 0 }
  const report = { scanned: 0, updated: 0 }
  const before = Number((database.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n)
  database.exec('begin')
  try {
    database.exec(`create table if not exists ${calendarEventCountryFixPolicy.backupTable} as select * from ${table}`)
    // 数组身份的 id 取第一段：源给的写法是 `["214790",79090]`——**数值没有引号，不是合法 JSON**，
    // 所以这里按位置截取（`json_extract` 在这批行上会直接报 malformed JSON）。
    const update = database.prepare(`update ${table} set country_code = ?
      where metric_key like '[%'
        and substr(metric_key, 3, instr(substr(metric_key, 3), '"') - 1) = ?
        and country_code <> ?`)
    for (const [sourceId, countryCode] of Object.entries(eventCountryFixes)) {
      const result = update.run(countryCode, sourceId, countryCode)
      report.updated += Number(result.changes)
      report.scanned += 1
    }
    const after = Number((database.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n)
    // 只改国家值：行数必须守恒，变了就是这条 SQL 改错了范围。
    if (after !== before) throw new Error(`country fix changed row count: before=${before} after=${after}`)
    database.prepare('insert or ignore into mi_macro_calendar_migrations(version) values (?)').run(version)
    database.exec('commit')
    return report
  } catch (error) {
    database.exec('rollback')
    throw error
  }
}
