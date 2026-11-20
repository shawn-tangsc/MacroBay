import type { DatabaseSync } from 'node:sqlite'

import { calendarStandardTablePolicy } from './marketCalendarStandardTable'

/**
 * **FOMC 各次会议被标成「经济指标」**（迁移 20，用户 2026-11-17 批）。
 *
 * 真库里 `US.FOMC.<日期>` 共 57 行，身份写法已经与事件一致（类型 + 日期），但 `event_type` 是
 * `economic-indicator`——它们会被计入指标数、进分级、参与指标口径统计。FOMC 决议是**事件**。
 *
 * 只改 `event_type`，**身份一个字不动**（`US.FOMC.<日期>` 保持不变）；备份、单事务、行数守恒、幂等。
 *
 * 上一轮我按「不以 `US.` 开头」去筛，正好漏掉它们——它们以 `US.FOMC.` 开头，看起来像指标。
 * 所以这里按**身份形状**判（`US.FOMC.` 前缀 + 日期后缀），不按国家前缀。
 */
export const calendarFomcEventTypeFixPolicy = Object.freeze({
  migrationVersion: 20,
  backupTable: 'mi_calendar_events__fomc_type_v20',
  identityPattern: /^US\.FOMC\.\d{4}-\d{2}-\d{2}$/
})

export type FomcEventTypeFixReport = Readonly<{ scanned: number; updated: number }>

export function fixFomcEventTypes(database: DatabaseSync): FomcEventTypeFixReport {
  const table = calendarStandardTablePolicy.eventsTable
  const version = calendarFomcEventTypeFixPolicy.migrationVersion
  const done = database.prepare('select 1 from mi_macro_calendar_migrations where version = ?').get(version)
  if (done !== undefined) return { scanned: 0, updated: 0 }
  const before = Number((database.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n)
  let report = { scanned: 0, updated: 0 }
  database.exec('begin')
  try {
    database.exec(`create table if not exists ${calendarFomcEventTypeFixPolicy.backupTable} as select * from ${table}`)
    const rows = database.prepare(`select metric_key from ${table}
      where event_type = 'economic-indicator' and metric_key like 'US.FOMC.%'`).all() as unknown as { metric_key: string }[]
    const update = database.prepare(`update ${table} set event_type = 'central-bank-activity'
      where metric_key = ? and event_type = 'economic-indicator'`)
    for (const row of rows) {
      // 身份形状必须真的是 `US.FOMC.<日期>`：`US.FOMC` 这种没有日期的写法不在这里动。
      if (!calendarFomcEventTypeFixPolicy.identityPattern.test(row.metric_key)) continue
      report.scanned += 1
      report.updated += Number(update.run(row.metric_key).changes)
    }
    const after = Number((database.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n)
    if (after !== before) throw new Error(`fomc type fix changed row count: before=${before} after=${after}`)
    database.prepare('insert or ignore into mi_macro_calendar_migrations(version) values (?)').run(version)
    database.exec('commit')
    return report
  } catch (error) {
    database.exec('rollback')
    throw error
  }
}
