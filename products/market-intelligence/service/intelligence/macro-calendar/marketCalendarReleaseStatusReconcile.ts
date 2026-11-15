import type { DatabaseSync } from 'node:sqlite'

import { calendarStandardTablePolicy } from './marketCalendarStandardTable'
import { deriveReleaseStatus, type DerivedReleaseStatus } from './marketCalendarReleaseStatusRule'

/**
 * **一次性回填 + 常规对账**：把「已过发布日、却还挂着 `scheduled`」的行按五态规则落到
 * `published` / `backfilling` / `missing`（`unknown` 一并归到 `missing`）。
 *
 * 用户报的那一幕就是这个函数不存在：CPI 11-10 四条**一直在表里**，`status` 挂着 `scheduled`、
 * 值全空，于是卡片写「未提供」、月历不算已发布。规矩两条：
 * 1. **过期后永远不许再出现 `scheduled`**（那是今天这个 bug 的直接来源）；
 * 2. **幂等**：状态由「日期 + 有没有值 + 窗口 + 次数」纯推导，跑两遍结果一致；不改值、只改状态。
 *
 * 挂在启动 wiring（与历史回放、CHECK 迁移同一点），不对运行中的库手工写。
 */
export type ReleaseStatusReconcileReport = Readonly<{
  scanned: number
  updated: number
  before: Readonly<Record<string, number>>
  after: Readonly<Record<string, number>>
}>

type Row = Readonly<{ country_code: string; metric_key: string; period_key: string; first_scheduled_date: string
  scheduled_date: string; scheduled_at: string | null; status: string; value_state: string | null
  values_json: string }>

const countByStatus = (database: DatabaseSync): Record<string, number> => {
  const rows = database.prepare(`select status, count(*) as c from ${calendarStandardTablePolicy.eventsTable} group by status`)
    .all() as { status: string; c: number }[]
  return Object.fromEntries(rows.map((row) => [row.status, row.c]))
}

const hasActual = (row: Row): boolean => {
  if (row.value_state === 'present') return true
  try {
    const values = JSON.parse(row.values_json) as { actual?: unknown }
    return typeof values.actual === 'string' && values.actual.trim() !== ''
  } catch { return false }
}

export function reconcileExpiredReleaseStatuses(database: DatabaseSync, input: Readonly<{
  today: string
  nowMs: number
}>): ReleaseStatusReconcileReport {
  const before = countByStatus(database)
  // 只碰「过期 + 状态还是 scheduled/unknown」的行：`published`/`cancelled`/新两态不动，避免来回改写。
  const rows = database.prepare(`select country_code, metric_key, period_key, first_scheduled_date,
      scheduled_date, scheduled_at, status, value_state, values_json
    from ${calendarStandardTablePolicy.eventsTable}
    where scheduled_date <= ? and status in ('scheduled', 'unknown')`).all(input.today) as unknown as Row[]
  const update = database.prepare(`update ${calendarStandardTablePolicy.eventsTable} set status = ?
    where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ?`)
  let updated = 0
  database.exec('begin')
  try {
    for (const row of rows) {
      const releaseAtMs = Date.parse(row.scheduled_at ?? `${row.scheduled_date}T00:00:00.000Z`)
      const next: DerivedReleaseStatus = deriveReleaseStatus({
        sourceStatus: row.status === 'unknown' ? 'unknown' : 'scheduled',
        scheduledDate: row.scheduled_date,
        today: input.today,
        hasActual: hasActual(row),
        attempts: 0,
        nowMs: input.nowMs,
        releaseAtMs: Number.isFinite(releaseAtMs) ? releaseAtMs : input.nowMs
      })
      if (next === row.status) continue
      update.run(next, row.country_code, row.metric_key, row.period_key, row.first_scheduled_date)
      updated += 1
    }
    database.exec('commit')
  } catch (error) {
    try { database.exec('rollback') } catch { /* 保留原始错误 */ }
    throw error
  }
  return { scanned: rows.length, updated, before, after: countByStatus(database) }
}
