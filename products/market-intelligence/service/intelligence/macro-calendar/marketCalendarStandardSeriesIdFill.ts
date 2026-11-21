import type { DatabaseSync } from 'node:sqlite'

import { calendarStandardTablePolicy } from './marketCalendarStandardTable'

/**
 * **把源内身份的稳定指标 id 补进标准表**（`series_id`，0.4.5 #14 的第二半）。
 *
 * 为什么要这一步：显示名的登记表 `sourceIdentityDisplayNames` 是按**源自己的稳定指标 id**
 * （观测表 `indicator_id`）建的——德国那 27 条就是 `9553` 这种。但标准表的数组身份行
 * `metric_key` 第一段是「每次发布一个新 id」（真库 1943 行对应 1544 个第一段，同一个指标
 * 每期换一个），所以按身份第一段永远查不到登记表：登记了也显示不出来，等于没登记。
 *
 * 三条口径：
 * 1. **只补空值**：已经有 `series_id` 的行一个字不动；
 * 2. **来源是观测表**：同一个 `source_event_id` 的 `indicator_id` 是源自己说的，不是我们推的；
 *    观测表不在（旧库/删过）就整条跳过，报 0，不猜；
 * 3. **判据是缺口**：还有「数组身份 + 没有 series_id」的行才跑，为 0 直接返回（团队规范
 *    「Backfills: Gap Or Marker, Never Both」）。
 *
 * 不改身份、不动主键、不发网络请求；跑第二遍 0 变更。
 */
export type SeriesIdFillReport = Readonly<{
  /** 还缺 `series_id` 的数组身份行数。 */
  pending: number
  /** 这一次补上的行数。 */
  filled: number
}>

export function fillStandardSeriesIds(database: DatabaseSync): SeriesIdFillReport {
  const table = calendarStandardTablePolicy.eventsTable
  const observations = 'mi_macro_calendar_market_event_observations'
  if (database.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(observations) === undefined) {
    return { pending: 0, filled: 0 }
  }
  const awaiting = database.prepare(`select rowid as rowId, source_event_id from ${table}
    where metric_key like '[%' and (series_id is null or trim(series_id) = '')`).all() as unknown as
    { rowId: number; source_event_id: string }[]
  if (awaiting.length === 0) return { pending: 0, filled: 0 }
  /**
   * **在内存里建一次映射，再逐行 update**：相关子查询版本在真库副本上实测 3.2 秒（观测表
   * `source_event_id` 没有索引），启动链吃不消；这里一次分组扫描 + 一个事务，行数一样。
   */
  const byId = new Map<string, string>()
  for (const row of database.prepare(`select source_event_id, indicator_id, max(last_seen_at) as seen
    from ${observations}
    where indicator_id is not null and trim(indicator_id) <> ''
    group by source_event_id order by seen asc`).all() as unknown as
  { source_event_id: string; indicator_id: string }[]) byId.set(row.source_event_id, row.indicator_id)
  if (byId.size === 0) return { pending: awaiting.length, filled: 0 }
  const update = database.prepare(`update ${table} set series_id = ? where rowid = ?`)
  let filled = 0
  database.exec('begin')
  try {
    for (const row of awaiting) {
      const indicatorId = byId.get(row.source_event_id)
      if (indicatorId === undefined) continue
      filled += Number(update.run(indicatorId, row.rowId).changes)
    }
    database.exec('commit')
  } catch (error) {
    database.exec('rollback')
    throw error
  }
  return { pending: awaiting.length, filled }
}