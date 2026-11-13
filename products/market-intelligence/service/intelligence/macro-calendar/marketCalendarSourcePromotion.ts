import type { DatabaseSync } from 'node:sqlite'

import { calendarStandardTablePolicy } from './marketCalendarStandardTable'
import { eventCodeBySourceType } from './marketCalendarEventCodeTable'
import { narwhalPrimaryMetricBySeriesId } from './narwhal-calendar/narwhalSeriesPrimaryMetric'

/**
 * **转正入口**：把 `identity_kind = 'source'` 的行按**当前映射表**重算身份，算得出的原地改成
 * `code`（`metric_key` 换标准码，`source_label` 保留），算不出的留在原地。
 *
 * 为什么是一个具名操作而不是散落的重试：补映射是常态（「128 条不是全量，是已见过的」），
 * 每次补完都要把存量转正。三个调用点——采集时（写之前就查，新映射当批生效）、启动时（补
 * 映射之前写进去的存量）、手动 dry-run（先看数再真跑）——都走这**一个**实现。
 *
 * 三条硬约束：
 * 1. **幂等**：同一行转两次不新增、不改第二次（第二次扫到它时已经不是 `source` 了）。
 * 2. **dryRun 不写库**：只报会转正几条。
 * 3. **清单联动**：转正成功后，`unmapped` 里对应的条目一起移除——否则清单会一直挂着
 *    已经解决的行，久了就没人看。
 */
export type PromotionCounts = Readonly<{ scanned: number; promoted: number; stillSource: number }>

export function promoteSourceIdentities(database: DatabaseSync, options?: Readonly<{
  provider?: string
  dryRun?: boolean
}>): PromotionCounts {
  const { eventsTable, unmappedTable } = calendarStandardTablePolicy
  const provider = options?.provider
  const rows = database.prepare(`select country_code, metric_key, period_key, scheduled_date,
    source_provider_id, source_event_id, source_label, series_id
    from ${eventsTable} where identity_kind = 'source'
    ${provider === undefined ? '' : 'and source_provider_id = ?'}`)
    .all(...(provider === undefined ? [] : [provider])) as {
      country_code: string; metric_key: string; period_key: string; scheduled_date: string
      source_provider_id: string; source_event_id: string; source_label: string | null; series_id: string | null
    }[]
  let promoted = 0
  for (const row of rows) {
    // 先按 series（组主测度的依据），再按源类型串（事件码）。**都不猜名字**：两张表里没有就是没有。
    const metricKey = (row.series_id === null ? undefined : narwhalPrimaryMetricBySeriesId[row.series_id])
      ?? (row.source_label === null ? undefined : eventCodeBySourceType[row.source_label])
    if (metricKey === undefined || metricKey === row.metric_key) continue
    if (options?.dryRun !== true) {
      try {
        database.prepare(`update ${eventsTable} set metric_key = ?, identity_kind = 'code'
          where source_provider_id = ? and source_event_id = ? and identity_kind = 'source'`)
          .run(metricKey, row.source_provider_id, row.source_event_id)
      } catch {
        // 主键冲突＝同一身份在同一天已经有一行标准码行（值后到那种）。这时源内身份那行是
        // **同一件事的另一份记录**，转正就是把它并进去：删掉它，**不留两行**。
        database.prepare(`delete from ${eventsTable}
          where source_provider_id = ? and source_event_id = ? and identity_kind = 'source'`)
          .run(row.source_provider_id, row.source_event_id)
      }
      // 清单里对应的条目：身份已经算出来了，它不是「还要补映射」的行了。
      database.prepare(`delete from ${unmappedTable} where provider_id = ? and source_key = ?`)
        .run(row.source_provider_id, row.source_event_id)
    }
    promoted += 1
  }
  return { scanned: rows.length, promoted, stillSource: rows.length - promoted }
}
