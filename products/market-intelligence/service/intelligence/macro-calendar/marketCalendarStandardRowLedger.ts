import type { DatabaseSync } from 'node:sqlite'

import { calendarStandardTablePolicy } from './marketCalendarStandardTable'

/**
 * **台账零孤儿**（从 `marketCalendarStandardTable` 抽出，体积门禁：那个文件 509 行）。
 *
 * 这张表存在的意义只有一个：**「清单里有、表里没有」必须能查出来、且必须为 0**。
 * 11-14 撤掉 0xrouter 那 659 行时没撤台账，留下 916 条孤儿——一次 `/tmp` 脚本清掉了，但那不是判据。
 * 所以判定与修复放在这里，配一条能跑红的用例（造一条孤儿 → 能查出来 → 清掉 → 再清返回 0）。
 *
 * 判定用「`source_event_id` 匹配 **或** 身份（国家+码+期间+首发布日）匹配」：源重发会覆盖
 * `source_event_id`，只按 id 比会把合法台账误判成孤儿。
 */

/**
 * **台账零孤儿**：`mi_calendar_event_source_ids` 里指向已不存在标准行的行，删掉并返回条数（幂等）。
 *
 * 这张表存在的意义只有一个：**「清单里有、表里没有」必须能查出来、且必须为 0**。11-14 撤掉
 * 0xrouter 那 659 行时没撤台账，留下 916 条孤儿——一次 `/tmp` 脚本清掉了，但那不是判据。
 * 所以判定与修复都放在这里，配一条能跑红的用例（造一条孤儿 → 能查出来 → 清掉 → 再清返回 0）。
 *
 * 判定用「`source_event_id` 匹配 **或** 身份（国家+码+期间+首发布日）匹配」：源重发会覆盖
 * `source_event_id`，只按 id 比会把合法台账误判成孤儿。
 */
export function countOrphanSourceIds(database: DatabaseSync): number {
  const row = database.prepare(`select count(*) as c from ${calendarStandardTablePolicy.sourceIdsTable} s
    where not exists (select 1 from ${calendarStandardTablePolicy.eventsTable} e
      where e.source_event_id = s.source_event_id
        or (e.country_code = s.country_code and e.metric_key = s.metric_key
            and e.period_key = s.period_key and e.first_scheduled_date = s.first_scheduled_date))`).get() as
    { c: number } | undefined
  return row?.c ?? 0
}

export function pruneOrphanSourceIds(database: DatabaseSync): number {
  const result = database.prepare(`delete from ${calendarStandardTablePolicy.sourceIdsTable} as s
    where not exists (select 1 from ${calendarStandardTablePolicy.eventsTable} e
      where e.source_event_id = s.source_event_id
        or (e.country_code = s.country_code and e.metric_key = s.metric_key
            and e.period_key = s.period_key and e.first_scheduled_date = s.first_scheduled_date))`).run()
  return Number(result.changes)
}

