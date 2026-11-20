import type { DatabaseSync } from 'node:sqlite'

import { marketCalendarPublicPolicy } from '../../../contracts/macro/marketCalendarQueryContracts'
import { calendarStandardTablePolicy } from './marketCalendarStandardTable'
import { fredSeriesFor } from './fredIndicatorYoY'

/**
 * **历史补值**（管欠账，管未来的是补值扫描）。
 *
 * 为什么需要单独一笔：回填把「过期且已超 24 小时窗口」的行落成了 `missing` 终态，扫描只扫非终态——
 * 所以 CPI 11-10 那四行**永远不会被扫描问到**。但那不是「这一期没有值」，是我们没去要过。
 *
 * 四条规矩（Chief 2026-11-16，第 4 条 2026-11-21 改）：
 * 1. **只动「该期间确有一期官方观测」的行**；拿不到就维持 `missing`，**不许跳回 `backfilling`**（界面会闪）；
 * 2. **期次严格相等**：9 月的值不能填 10 月；
 * 3. **幂等**：只补空值，跑两遍第二遍 `updated: 0`；
 * 4. **不进扫描节拍**（仍是这条），但**启动判据改成差集，不再用迁移标记**：扫描只扫非终态，
 *    而每期发布过期后都会落成 `missing` 终态——这个形状**每天新来**，标记挡着就永远补不上
 *    （团队规范「Backfills: Gap Or Marker, Never Both」）。每次启动算一次「还有多少行该补」，
 *    为 0 就跳过；有缺口就补，读完仍拿不到的行下轮再试（读不到与「源没给」在这里是两种状态，
 *    不许把前者写成后者）。
 */
export const historicalValueFillPolicy = Object.freeze({
  migrationVersion: 13,
  /** 只有登记过官方序列的码才去要值；没登记的直接跳过，不猜。 */
  skipReasons: Object.freeze(['no-series', 'no-observation', 'period-mismatch'] as const)
})

export type HistoricalValueFillReport = Readonly<{
  scanned: number
  filled: number
  skipped: Readonly<Record<string, number>>
}>

const emptySkips = (): Record<string, number> =>
  Object.fromEntries(historicalValueFillPolicy.skipReasons.map((reason) => [reason, 0]))

/** 该补值的候选行：**fill 与启动闸共用这一处判据**，两处各写一份迟早会漂。 */
function openReleaseRowsAwaitingValue(database: DatabaseSync, today: string): readonly Readonly<{
  country_code: string; metric_key: string; period_key: string; first_scheduled_date: string; values_json: string
}>[] {
  // 状态集合**从契约的闭集派生**，不在这里再抄一份：`published` 与 `cancelled` 之外都是欠账候选。
  const openStatuses = marketCalendarPublicPolicy.releaseStatuses
    .filter((status) => status !== 'published' && status !== 'cancelled')
  return database.prepare(`select country_code, metric_key, period_key, first_scheduled_date, values_json
    from ${calendarStandardTablePolicy.eventsTable}
    where scheduled_date <= ? and row_kind = 'release' and status in (${openStatuses.map(() => '?').join(', ')})
      and (json_extract(values_json, '$.actual') is null
        or trim(cast(json_extract(values_json, '$.actual') as text)) = '')`)
    .all(today, ...openStatuses) as unknown as { country_code: string; metric_key: string; period_key: string
      first_scheduled_date: string; values_json: string }[]
}

export async function fillHistoricalReleaseValues(database: DatabaseSync, input: Readonly<{
  today: string
  nowMs: number
  /**
   * 官方序列读数：给它**目标期次**，返回该期确有观测时的（期次 + 值），否则 `undefined`。
   * 契约里带期次是故意的：只给「最新一条」，调用方就得自己判期次，而「9 月顶 10 月」正是
   * 那类判断最容易走样的地方。
   */
  readLatest: (metricKey: string, periodKey: string) => Promise<Readonly<{ period: string; value: string }> | undefined>
  maximumReads?: number
}>): Promise<HistoricalValueFillReport> {
  const rows = openReleaseRowsAwaitingValue(database, input.today)
  /**
   * **状态与 `value_state` 都由「这次到底拿到值没有」决定**（Chief 2026-11-19）：
   * 拿到非空 `actual` 才写 `present` + 推进 `published`；拿到**空值**（FRED `pc1` 在 2026-10 就是空）
   * 只写 `missing`，**不推进状态**——否则读者看到「已发布 + 无值」，而事实是「源没给这一期」。
   */
  const updateWithValue = database.prepare(`update ${calendarStandardTablePolicy.eventsTable}
    set status = 'published', value_state = 'present', values_json = ?, observed_at = ?
    where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ?`)
  const updateWithoutValue = database.prepare(`update ${calendarStandardTablePolicy.eventsTable}
    set value_state = 'missing', values_json = ?, observed_at = ?
    where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ?`)
  const skips = emptySkips()
  const maximumReads = input.maximumReads ?? 40
  const seen = new Map<string, { period: string; value: string } | undefined>()
  let reads = 0
  let filled = 0
  for (const row of rows) {
    if (fredSeriesFor(row.metric_key) === undefined) { skips['no-series'] += 1; continue }
    // 去重键带期次（只按期次前 7 位）：同一指标的相邻两期是**两件事**，按指标去重会让第二期
    // 永远拿到第一期的读数；而 `2026-10` 与 `2026-M10` 这种同一期的两种写法共用一次请求。
    const key = `${row.metric_key}|${row.period_key.slice(0, 7)}`
    let reading = seen.get(key)
    if (reading === undefined && !seen.has(key)) {
      if (reads >= maximumReads) continue
      reads += 1
      reading = await input.readLatest(row.metric_key, row.period_key)
      seen.set(key, reading)
    }
    if (reading === undefined) { skips['no-observation'] += 1; continue }
    // 期次严格相等：`2026-10` 只认 `2026-10`（季度码取前 7 位比较）。
    if (!reading.period.startsWith(row.period_key.slice(0, 7))) { skips['period-mismatch'] += 1; continue }
    const valuesJson = JSON.stringify({ actual: reading.value })
    const hasValue = typeof reading.value === 'string' && reading.value.trim() !== ''
    const update = hasValue ? updateWithValue : updateWithoutValue
    if (!hasValue) skips['empty-value'] = (skips['empty-value'] ?? 0) + 1
    update.run(valuesJson, new Date(input.nowMs).toISOString(),
      row.country_code, row.metric_key, row.period_key, row.first_scheduled_date)
    if (hasValue) filled += 1
  }
  return { scanned: rows.length, filled, skipped: skips }
}

/** 启动入口：带迁移标记，只跑一次；失败不留半标记（与回放同一套语义）。 */
export function ensureHistoricalValuesFilled(database: DatabaseSync, input: Readonly<{
  today: string
  nowMs: number
  readLatest: (metricKey: string, periodKey: string) => Promise<Readonly<{ period: string; value: string }> | undefined>
}>): Promise<boolean> {
  return (async () => {
    try {
      // 老库里的标记行同笔清掉：留着会让下一个人以为这条还受版本闸控制。
      // 迁移表可能不存在（启动链里有先例），清理是附带动作，缺表不是错误。
      if (database.prepare("select 1 from sqlite_master where type = 'table' and name = 'mi_macro_calendar_migrations'").get() !== undefined) {
        database.prepare('delete from mi_macro_calendar_migrations where version = ?')
          .run(historicalValueFillPolicy.migrationVersion)
      }
      // **判据是当前缺口**：还有「已过排期、没发布/没取消、`values_json` 里没有 actual」的行才跑。
      // 为 0 就直接返回——不扫描、不读官方序列。每期发布过期后都会落成 `missing` 终态，
      // 所以这个形状每天新来，标记挡着就永远补不上（团队规范「Backfills: Gap Or Marker」）。
      if (openReleaseRowsAwaitingValue(database, input.today).length === 0) return false
      const report = await fillHistoricalReleaseValues(database, input)
      console.warn(`[macro-calendar] 历史补值：扫描 ${report.scanned} 行、补上 ${report.filled} 行、跳过 ${JSON.stringify(report.skipped)}`)
      return true
    } catch (error) {
      console.warn(`[macro-calendar] 历史补值失败（已忽略，下次启动重试）：${(error as Error)?.message ?? 'unknown'}`)
      return false
    }
  })()
}
