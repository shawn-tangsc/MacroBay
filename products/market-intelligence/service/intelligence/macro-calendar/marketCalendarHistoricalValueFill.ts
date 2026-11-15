import type { DatabaseSync } from 'node:sqlite'

import { calendarStandardTablePolicy } from './marketCalendarStandardTable'
import { fredSeriesFor } from './fredIndicatorYoY'

/**
 * **一次性历史补值**（管欠账，管未来的是补值扫描）。
 *
 * 为什么需要单独一笔：回填把「过期且已超 24 小时窗口」的行落成了 `missing` 终态，扫描只扫非终态——
 * 所以 CPI 11-10 那四行**永远不会被扫描问到**。但那不是「这一期没有值」，是我们没去要过。
 *
 * 四条规矩（Chief 2026-11-16）：
 * 1. **只动「该期间确有一期官方观测」的行**；拿不到就维持 `missing`，**不许跳回 `backfilling`**（界面会闪）；
 * 2. **期次严格相等**：9 月的值不能填 10 月；
 * 3. **幂等**：迁移标记 + 只补空值，跑两遍第二遍 `updated: 0`；
 * 4. **不改未来的正常过期行为**：只从「迁移版本」这一个入口跑一次，**不进扫描节拍**。
 */
export const historicalValueFillPolicy = Object.freeze({
  migrationVersion: 13,
  /** 只有登记过官方序列的码才去要值；没登记的直接跳过，不猜。 */
  skipReasons: Object.freeze(['no-series', 'no-observation', 'period-mismatch', 'already-has-value'] as const)
})

export type HistoricalValueFillReport = Readonly<{
  scanned: number
  filled: number
  skipped: Readonly<Record<string, number>>
}>

const emptySkips = (): Record<string, number> =>
  Object.fromEntries(historicalValueFillPolicy.skipReasons.map((reason) => [reason, 0]))

const hasActual = (valuesJson: string): boolean => {
  try {
    const values = JSON.parse(valuesJson) as { actual?: unknown }
    return typeof values.actual === 'string' && values.actual.trim() !== ''
  } catch { return false }
}

export async function fillHistoricalReleaseValues(database: DatabaseSync, input: Readonly<{
  today: string
  nowMs: number
  /** 官方序列读数：返回该指标**最新一次**有值的观测（期次 + 值），拿不到返回 undefined。 */
  readLatest: (metricKey: string) => Promise<Readonly<{ period: string; value: string }> | undefined>
  maximumReads?: number
}>): Promise<HistoricalValueFillReport> {
  const rows = database.prepare(`select country_code, metric_key, period_key, first_scheduled_date, values_json
    from ${calendarStandardTablePolicy.eventsTable}
    where scheduled_date <= ? and row_kind = 'release' and status in ('missing', 'scheduled', 'backfilling', 'unknown')`)
    .all(input.today) as unknown as { country_code: string; metric_key: string; period_key: string
      first_scheduled_date: string; values_json: string }[]
  const update = database.prepare(`update ${calendarStandardTablePolicy.eventsTable}
    set status = 'published', value_state = 'present', values_json = ?, observed_at = ?
    where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ?`)
  const skips = emptySkips()
  const maximumReads = input.maximumReads ?? 40
  const seen = new Map<string, { period: string; value: string } | undefined>()
  let reads = 0
  let filled = 0
  for (const row of rows) {
    if (hasActual(row.values_json)) { skips['already-has-value'] += 1; continue }
    if (fredSeriesFor(row.metric_key) === undefined) { skips['no-series'] += 1; continue }
    let reading = seen.get(row.metric_key)
    if (reading === undefined && !seen.has(row.metric_key)) {
      if (reads >= maximumReads) continue
      reads += 1
      reading = await input.readLatest(row.metric_key)
      seen.set(row.metric_key, reading)
    }
    if (reading === undefined) { skips['no-observation'] += 1; continue }
    // 期次严格相等：`2026-10` 只认 `2026-10`（季度码取前 7 位比较）。
    if (!reading.period.startsWith(row.period_key.slice(0, 7))) { skips['period-mismatch'] += 1; continue }
    update.run(JSON.stringify({ actual: reading.value }), new Date(input.nowMs).toISOString(),
      row.country_code, row.metric_key, row.period_key, row.first_scheduled_date)
    filled += 1
  }
  return { scanned: rows.length, filled, skipped: skips }
}

/** 启动入口：带迁移标记，只跑一次；失败不留半标记（与回放同一套语义）。 */
export function ensureHistoricalValuesFilled(database: DatabaseSync, input: Readonly<{
  today: string
  nowMs: number
  readLatest: (metricKey: string) => Promise<Readonly<{ period: string; value: string }> | undefined>
}>): Promise<boolean> {
  return (async () => {
    try {
      const marker = database.prepare('select 1 from mi_macro_calendar_migrations where version = ?')
        .get(historicalValueFillPolicy.migrationVersion)
      if (marker !== undefined) return false
      const report = await fillHistoricalReleaseValues(database, input)
      database.prepare('insert or ignore into mi_macro_calendar_migrations(version) values (?)')
        .run(historicalValueFillPolicy.migrationVersion)
      console.warn(`[macro-calendar] 历史补值：扫描 ${report.scanned} 行、补上 ${report.filled} 行、跳过 ${JSON.stringify(report.skipped)}`)
      return true
    } catch (error) {
      console.warn(`[macro-calendar] 历史补值失败（已忽略，下次启动重试）：${(error as Error)?.message ?? 'unknown'}`)
      return false
    }
  })()
}
