import type { DatabaseSync } from 'node:sqlite'

import { calendarStandardTablePolicy } from './marketCalendarStandardTable'

/**
 * **回填「这一行是什么」与重要性**（迁移 16，Chief 2026-11-16 定：两列一起补）。
 *
 * 起因：标准表里没有任何一列能表达「经济数据 / 财经事件 / 央行活动」。0xrouter 采集时本来知道
 * （观测表的 `event_kind`），但落表时没保留，于是读侧只能靠 `metric_key` 前缀猜——**423 行上游
 * ID 数组身份（`["212058",70663]`）全被猜成经济指标**，英伟达全员会因此被标成经济指标、
 * 还进简报拿了「流动性」角色。`importance` 同源（#23）：写入时没存，读侧只能给默认值。
 *
 * 三条规矩：
 * 1. **只补空值**：已有 `event_type`/`importance` 的行不覆盖（写入侧从今天起会自己写）；
 * 2. **类型来源按可信度排序**：观测表 `event_kind`（源自己的事实）→ `evt.` 前缀规则 → 经济指标；
 * 3. **重要性只从 0xrouter 的观测复制**：narwhal 那列是占位值（172/223 全 `medium`，见 #23），
 *    复制它等于把我们自己编的数当成来源判断——**宁可留空，读侧显示「未分级」**。
 *
 * 幂等：判据是「表里已无 `event_type` 为空的行」；再跑必须 0 变更。行数不变（只更新列）。
 */
export const calendarEventTypeBackfillPolicy = Object.freeze({
  migrationVersion: 16,
  eventTypes: ['economic-indicator', 'financial-event', 'central-bank-activity'] as const,
  /** 只有这个来源的 `importance` 是事实；其余（含 narwhal 的占位 medium）不复制。 */
  importanceTrustedProvider: '0xrouter'
})

export type EventTypeBackfillReport = Readonly<{
  pending: number
  eventTypeFilled: number
  importanceFilled: number
}>

const emptyReport = (): EventTypeBackfillReport => ({ pending: 0, eventTypeFilled: 0, importanceFilled: 0 })

export function backfillCalendarEventTypes(database: DatabaseSync): EventTypeBackfillReport {
  const table = calendarStandardTablePolicy.eventsTable
  const version = calendarEventTypeBackfillPolicy.migrationVersion
  const done = database.prepare('select 1 from mi_macro_calendar_migrations where version = ?').get(version)
  if (done !== undefined) return emptyReport()
  const pending = Number((database.prepare(`select count(*) as n from ${table} where event_type is null`).get() as { n: number }).n)
  const observations = database.prepare("select 1 from sqlite_master where type = 'table' and name = 'mi_macro_calendar_market_event_observations'").get()
  if (pending === 0 && observations === undefined) {
    database.prepare('insert or ignore into mi_macro_calendar_migrations(version) values (?)').run(version)
    return emptyReport()
  }
  const report = { pending, eventTypeFilled: 0, importanceFilled: 0 }
  database.exec('begin')
  try {
    if (observations !== undefined) {
      // ① 源自己的事实：观测表 `event_kind` 直接写回（同一发布 id）。
      report.eventTypeFilled += Number(database.prepare(`update ${table} set event_type = (
          select o.event_kind from mi_macro_calendar_market_event_observations o
          where o.source_event_id = ${table}.source_event_id
            and o.event_kind in ('economic-indicator', 'financial-event', 'central-bank-activity')
          limit 1)
        where event_type is null and exists (
          select 1 from mi_macro_calendar_market_event_observations o
          where o.source_event_id = ${table}.source_event_id
            and o.event_kind in ('economic-indicator', 'financial-event', 'central-bank-activity'))`).run().changes)
      // ② 重要性只从可信来源复制（narwhal 的 medium 是占位值，不复制）。
      report.importanceFilled += Number(database.prepare(`update ${table} set importance = (
          select o.importance from mi_macro_calendar_market_event_observations o
          where o.source_event_id = ${table}.source_event_id
            and o.provider_id = ? and o.importance in ('high', 'medium', 'low')
          limit 1)
        where importance is null and exists (
          select 1 from mi_macro_calendar_market_event_observations o
          where o.source_event_id = ${table}.source_event_id
            and o.provider_id = ? and o.importance in ('high', 'medium', 'low'))`)
        .run(calendarEventTypeBackfillPolicy.importanceTrustedProvider,
          calendarEventTypeBackfillPolicy.importanceTrustedProvider).changes)
    }
    // ③ 剩下的按前缀规则（事件码能定，指标码就是经济数据）——**不是猜，是闭集规则**。
    report.eventTypeFilled += Number(database.prepare(`update ${table} set event_type = case
        when metric_key like 'evt.central-bank%' or metric_key like 'evt.monetary-policy%' then 'central-bank-activity'
        when metric_key like 'evt.%' then 'financial-event'
        else 'economic-indicator' end
      where event_type is null`).run().changes)
    database.prepare('insert or ignore into mi_macro_calendar_migrations(version) values (?)').run(version)
    database.exec('commit')
    return report
  } catch (error) {
    database.exec('rollback')
    throw error
  }
}
