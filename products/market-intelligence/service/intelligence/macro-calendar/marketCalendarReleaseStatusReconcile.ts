import type { DatabaseSync } from 'node:sqlite'

import { marketCalendarPublicPolicy } from '../../../contracts/macro/marketCalendarQueryContracts'
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

/**
 * **「有实际值」只认 `values_json.actual`**，不认 `value_state`。
 *
 * `value_state = present` 的含义是「这一行有值区」（可能只有预期/前值），拿它当「已发布」的判据
 * 就会把「只有预期」的行判成已发布——帝国大厦那条正是这样被选中的（用户 2026-11-16 报）。
 */
const hasActual = (row: Row): boolean => {
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
  // 状态字面量**只许出现在契约闭集里**（`marketCalendarReleaseStatusUnionGuard`）：能往下走的几档
  // 从闭集派生，「已发布」单独走「没有实际值」那一支，取消与有值的已发布一律不动。
  const reDerivable = marketCalendarPublicPolicy.releaseStatuses
    .filter((status) => status !== 'published' && status !== 'cancelled')
  // 只碰「过期 + 状态还能往下走」的行：`published`（有实际值）/`cancelled` 不动，避免来回改写。
  // `backfilling` 也在里面：没有实际值的行会被写入端先退回 backfilling（见 `publishedNeedsActual`），
  // 24 小时窗口一过就必须由这里落成 missing——否则它会永远停在「待补值」，也就是另一种谎。
  const rows = database.prepare(`select country_code, metric_key, period_key, first_scheduled_date,
      scheduled_date, scheduled_at, status, value_state, values_json
    from ${calendarStandardTablePolicy.eventsTable}
    where scheduled_date <= ? and (status in (${reDerivable.map(() => '?').join(', ')})
      -- **已发布却没有实际值**：只有预期值时不算发布（用户 2026-11-16 报的帝国大厦那条就是）。
      -- 「优先信已发布」的逻辑会选中它，所以这类行必须按规则退回去。
      or (status = 'published' and (json_extract(values_json, '$.actual') is null
        or trim(cast(json_extract(values_json, '$.actual') as text)) = '')))`)
    .all(input.today, ...reDerivable) as unknown as Row[]
  const update = database.prepare(`update ${calendarStandardTablePolicy.eventsTable} set status = ?
    where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ?`)
  let updated = 0
  database.exec('begin')
  try {
    for (const row of rows) {
      const releaseAtMs = Date.parse(row.scheduled_at ?? `${row.scheduled_date}T00:00:00.000Z`)
      const next: DerivedReleaseStatus = deriveReleaseStatus({
        // `published` 但没值的行按「来源说已发布、事实没值」处理：derive 会退回 backfilling/missing。
        sourceStatus: row.status === 'published' ? 'published'
          : row.status === 'unknown' ? 'unknown' : 'scheduled',
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
