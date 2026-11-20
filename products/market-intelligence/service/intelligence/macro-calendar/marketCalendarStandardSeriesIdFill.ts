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
  const pending = Number((database.prepare(`select count(*) as n from ${table}
    where metric_key like '[%' and (series_id is null or trim(series_id) = '')`).get() as { n: number }).n)
  if (pending === 0) return { pending: 0, filled: 0 }
  const filled = Number(database.prepare(`update ${table} set series_id = (
      select o.indicator_id from ${observations} o
      where o.source_event_id = ${table}.source_event_id
        and o.indicator_id is not null and trim(o.indicator_id) <> ''
      order by o.last_seen_at desc limit 1)
    where metric_key like '[%' and (series_id is null or trim(series_id) = '')
      and exists (select 1 from ${observations} o
        where o.source_event_id = ${table}.source_event_id
          and o.indicator_id is not null and trim(o.indicator_id) <> '')`).run().changes)
  return { pending, filled }
}