import type { DatabaseSync } from 'node:sqlite'

import { ensureCalendarStandardTables } from '../intelligence/macro-calendar/marketCalendarStandardTable'
import { syncOfficialStandardRows } from '../intelligence/macro-calendar/marketCalendarOfficialSourceRows'
import { ensureOfficialHistoryReplayed } from '../intelligence/macro-calendar/marketCalendarOfficialHistoryReplay'

/**
 * 启动时把**本月与下月**的官方发布写进标准表。
 *
 * 不写进去，切读侧那天 CPI、非农、FOMC 会从日历上消失；官方行按「发布键 → 标准码」写，
 * 拼不出码的落源内身份（照样显示）。
 *
 * **失败不阻断启动**（红线 1）：整段包在 `try/catch` 里、catch 只打日志不抛——一个源不可用
 * 不许把整个产品拖起来不了。搬家时这两条日志逐字保留（`console.warn` 是这条链唯一的现场）。
 */
export function syncOfficialStandardRowsAtStartup(input: Readonly<{
  database: DatabaseSync
  listEffectiveMonthAsOf: Parameters<typeof syncOfficialStandardRows>[1]['listEffectiveMonthAsOf']
  /** 测试可注入的时钟；生产不传，用当前时刻。 */
  now?: () => Date
}>): void {
  try {
    const database = input.database
    ensureCalendarStandardTables(database)
    const now = (input.now ?? (() => new Date()))()
    const months = [now.toISOString().slice(0, 7),
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 7)]
    const synced = syncOfficialStandardRows(database, {
      listEffectiveMonthAsOf: input.listEffectiveMonthAsOf,
      months, asOf: now.toISOString(), parserVersion: 'official-standard-rows-v1',
      onError: (message: string) => console.warn(`[macro-calendar] 官方标准行写入失败：${message}`)
    })
    console.warn(`[macro-calendar] 官方发布入标准表：${months.join('/')} 读到 ${synced.revisions} 条、写入 ${synced.written} 条、失败 ${synced.failed} 条`)
    // **官方历史回放（S1）挂在这里**：同一个启动点、同一套「失败不阻断启动」的语义。
    // 带版本标记（迁移 12），跑过一次就跳过；bootstrap 一行都不用新增。
    try {
      ensureOfficialHistoryReplayed(database)
    } catch (error) {
      console.warn(`[macro-calendar] 官方历史回放失败（已忽略，下次启动重试）：${(error as Error)?.message ?? 'unknown'}`)
    }
  } catch (error) {
    console.warn(`[macro-calendar] 官方发布入标准表失败（已忽略）：${(error as Error)?.message ?? 'unknown'}`)
  }
}
