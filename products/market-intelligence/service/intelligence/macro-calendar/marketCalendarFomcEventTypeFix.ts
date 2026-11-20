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
 *
 * **判据是当前缺口，不是「跑过一次」**（2026-11-21）：这条原来读 `mi_macro_calendar_migrations`
 * 的版本 20，跑过一次就永远短路。但这类行**还会新来**：`backfillCalendarEventTypes` 按前缀规则给
 * 没类型的行补 `economic-indicator`，而 `US.FOMC.<日期>` 不以 `evt.` 开头，于是每来一场新会议
 * 就多一行「经济指标」，标记挡着不再改——**标记在、缺口在，两边看起来都正常**（团队规范
 * 「Backfills: Gap Or Marker, Never Both」）。写入端能继续产生这种形状 ⇒ 它是缺口型，不是迁移。
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
  // 老库留下的标记同时清掉：留着会让下一个人以为这条还受版本闸控制。
  database.prepare('delete from mi_macro_calendar_migrations where version = ?').run(version)
  // 先算「现在还剩多少条这种形状」：为 0 就跳过，不建备份、不开事务。
  const candidates = database.prepare(`select metric_key from ${table}
    where event_type = 'economic-indicator' and metric_key like 'US.FOMC.%'`).all() as unknown as { metric_key: string }[]
  const pending = candidates.filter((row) => calendarFomcEventTypeFixPolicy.identityPattern.test(row.metric_key))
  if (pending.length === 0) return { scanned: 0, updated: 0 }
  const before = Number((database.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n)
  let report = { scanned: 0, updated: 0 }
  database.exec('begin')
  try {
    database.exec(`create table if not exists ${calendarFomcEventTypeFixPolicy.backupTable} as select * from ${table}`)
    const update = database.prepare(`update ${table} set event_type = 'central-bank-activity'
      where metric_key = ? and event_type = 'economic-indicator'`)
    for (const row of pending) {
      // 身份形状必须真的是 `US.FOMC.<日期>`：`US.FOMC` 这种没有日期的写法不在这里动。
      report.scanned += 1
      report.updated += Number(update.run(row.metric_key).changes)
    }
    const after = Number((database.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n)
    if (after !== before) throw new Error(`fomc type fix changed row count: before=${before} after=${after}`)
    database.exec('commit')
    return report
  } catch (error) {
    database.exec('rollback')
    throw error
  }
}
