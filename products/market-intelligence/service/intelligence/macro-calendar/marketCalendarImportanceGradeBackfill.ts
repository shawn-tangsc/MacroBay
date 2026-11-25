import type { DatabaseSync } from 'node:sqlite'

import { calendarImportanceGradeForRow } from './calendarEventImportance'
import { calendarStandardTablePolicy } from './marketCalendarStandardPolicy'

/**
 * **重要性档的一次性启动回填**（Chief 2026-11-24 定）。
 *
 * 为什么需要：`importance_grade` 是后加的列，放进写入口之后，**只有被采集重写到的行**才是最新的；
 * 不在采集窗口里的未来行（还没到排期、这几周不会被任何源重发的那些）会一直 `NULL`。而 `NULL`
 * 在读者那边就是「未分级」——日历上不标档、提醒按 `importance-not-selected` 一律不推。
 *
 * 三条边界：
 * 1. **只填空、不覆盖**：`where importance_grade is null`。已有档是「已有结论」，要改它得走重写流程
 *    （写入端每次重写都按当前表重判），不在这里顺手改史；
 * 2. **用与写入端同一个纯函数**（`calendarImportanceGradeForRow`）：两处各写一份就会出现
 *    「写入判一个档、回填判另一个」，而它们判的是同一行；
 * 3. **判不出就留空**：数组身份、未列辖区这些本来就没有族——留 `NULL` 是「未分级」，
 *    不是补一个「低」。
 *
 * 幂等：第二遍扫到的只剩判不出的那批，`filled=0`、不写任何行。
 */
export type ImportanceGradeBackfillReport = Readonly<{
  /** 扫到的 `importance_grade is null` 行数。 */
  scanned: number
  /** 这一遍补上的行数。 */
  filled: number
  /** 扫完仍然是 NULL 的行数（＝没有族，属于「未分级」）。 */
  stillUngraded: number
}>

export function backfillCalendarImportanceGrades(database: DatabaseSync): ImportanceGradeBackfillReport {
  const { eventsTable } = calendarStandardTablePolicy
  const pending = database.prepare(`select rowid as rowId, country_code, metric_key
    from ${eventsTable} where importance_grade is null`).all() as Array<
    { rowId: number; country_code: string; metric_key: string }>
  if (pending.length === 0) return { scanned: 0, filled: 0, stillUngraded: 0 }

  // **写回也带 `importance_grade is null`**：并发/重复调用都不会把刚补上的档再盖掉，也不会覆盖别人写的档。
  const update = database.prepare(`update ${eventsTable} set importance_grade = ?
    where rowid = ? and importance_grade is null`)
  let filled = 0
  database.exec('begin immediate')
  try {
    for (const row of pending) {
      const tier = calendarImportanceGradeForRow({
        countryCode: String(row.country_code), metricKey: String(row.metric_key)
      })
      if (tier === undefined) continue
      const changes = Number(update.run(tier, Number(row.rowId)).changes)
      filled += changes
    }
    database.exec('commit')
  } catch (error) {
    try { database.exec('rollback') } catch { /* 保留原始错误 */ }
    throw error
  }
  return { scanned: pending.length, filled, stillUngraded: pending.length - filled }
}