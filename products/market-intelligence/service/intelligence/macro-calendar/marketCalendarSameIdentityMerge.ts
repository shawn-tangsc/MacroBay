import type { DatabaseSync } from 'node:sqlite'

import { calendarStandardTablePolicy } from './marketCalendarStandardTable'

/**
 * **同源中英两条合并**（迁移 18，用户 2026-11-17 批）。
 *
 * 起因：源对**同一件事**发了两条记录——一条中文名、一条英文名，两条的数组身份第一段相同
 * （`["214790",79090]` 与 `["214790",79095]` 都是 `214790`），于是被当成两个事件收进库里。
 * 真库实测 **249 组 / 502 行**：US 180 组、DE 78 组、BEA 1 组，每组都恰好一条中文名、一条英文名。
 *
 * 为什么不合并成「同一行两条名字都对」：主键含 `metric_key`，两条的 `metric_key` 不同就是两行，
 * 读取层能合只是显示层的事，库里仍是两行——补值、对账、`release_count` 都会各算各的。
 *
 * 合并规则：
 * - 分组键＝`源 + 国家 + 数组身份第一段 + 期次`。**不按名字匹配**，身份是源自己给的；
 *   期次用**精确值**、不按月份合并：同月改期（排期 11-12、实发 11-13）是两次排期记录，
 *   并成一行等于改历史，而且周度指标（钻井数、失业金）同月本来就有多次发布；
 * - 只合**数组身份**（`metric_key like '[%'`）。标准码身份里同期多行是**另一次发布**
 *   （BEA 二读/三读、BLS 改期），自己就能证明不是重复，不许合；
 * - 每组留一行：状态最强的留下（`published` > `backfilling` > `scheduled` > `unknown` >
 *   `missing` > `cancelled`），同级取**中文名那行**做显示；
 * - 英文原文名存进 `source_label_en`——**不丢**，英文读者仍能搜到；显示名不受它影响；
 * - 值逐字段取并集、**留下的那行优先**：合并只补空，不拿旧行盖掉发布行；
 * - 台账 `source_event_id` 全部**改指到留下的那一行**（删掉台账条目，下次采集英文 id 会再插一行，
 *   合并当场失效——这是这一笔最容易做漏的地方）；
 * - 整表备份、单事务、行数对账、迁移版本幂等（跑第二遍 0 变更）、**不 drop 表**。
 */
export const calendarSourceNameMergePolicy = Object.freeze({
  migrationVersion: 18,
  backupTable: 'mi_calendar_events__source_name_v18'
})

export type SourceNameMergeReport = Readonly<{
  /** 参与判定的重复组数（数组身份 + 期次月份）。 */
  groups: number
  mergedGroups: number
  removedRows: number
  /** 留下英文原文名的行数。 */
  englishNameStored: number
  /** 改指到留下那一行的台账条数。 */
  ledgerRewritten: number
  /** 同月但**期次不同**（改期）因而没合并的组数——留着是两次排期记录，不是重复。 */
  rescheduledKept: number
}>

type Row = Record<string, string | number | null>

const emptyReport = (): SourceNameMergeReport =>
  ({ groups: 0, mergedGroups: 0, removedRows: 0, englishNameStored: 0, ledgerRewritten: 0, rescheduledKept: 0 })

/** 数组身份的第一段＝源自己说的指标身份；标准码身份原样返回。 */
const identityExpr = `case when metric_key like '[%' and json_valid(metric_key)
  then json_extract(metric_key, '$[0]') else metric_key end`

const hasCjk = (value: string | null): boolean => value !== null && /[\u4e00-\u9fff]/.test(value)

/**
 * 状态强弱：合并同月两次排期时，**已发布的那行必须留下**。
 * 只用于「同一身份同期留哪一行」，不用于判断状态本身（状态由来源给，不按日期推）。
 */
const statusRank: Readonly<Record<string, number>> = Object.freeze({
  published: 5, backfilling: 4, scheduled: 3, unknown: 2, missing: 1, cancelled: 0
})

const rankOf = (row: Row): number => statusRank[String(row.status)] ?? 0

/** 值逐字段并集：**先到的留下，后到的只补空**（合并只补，不覆盖）。 */
function unionValues(base: string, other: string): string {
  const parse = (json: string): Record<string, unknown> => {
    try {
      const parsed = JSON.parse(json) as unknown
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
    } catch { return {} }
  }
  const merged = parse(base)
  for (const [key, value] of Object.entries(parse(other))) {
    const existing = merged[key]
    if (existing === undefined || existing === null || (typeof existing === 'string' && existing.trim() === '')) {
      merged[key] = value
    }
  }
  return JSON.stringify(merged)
}

export function mergeSameSourceNameRows(database: DatabaseSync): SourceNameMergeReport {
  const table = calendarStandardTablePolicy.eventsTable
  const ledger = calendarStandardTablePolicy.sourceIdsTable
  const version = calendarSourceNameMergePolicy.migrationVersion
  const done = database.prepare('select 1 from mi_macro_calendar_migrations where version = ?').get(version)
  if (done !== undefined) return emptyReport()

  const groups = database.prepare(`select country_code, source_provider_id,
      ${identityExpr} as identity, period_key, count(*) as n
    from ${table} where metric_key like '[%'
    group by country_code, source_provider_id, identity, period_key having n > 1`).all() as unknown as
    { country_code: string; source_provider_id: string; identity: string; period_key: string; n: number }[]
  const rescheduledKept = Number((database.prepare(`select count(*) as n from (
      select 1 from ${table} where metric_key like '[%'
      group by country_code, source_provider_id, ${identityExpr}, substr(period_key, 1, 7)
      having count(distinct period_key) > 1)`).get() as { n: number }).n)
  const report = { ...emptyReport(), groups: groups.length, rescheduledKept }
  if (groups.length === 0) {
    database.prepare('insert or ignore into mi_macro_calendar_migrations(version) values (?)').run(version)
    return report
  }
  const before = Number((database.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n)
  database.exec('begin')
  try {
    // 备份整表（含新增列）；改名不是必须——迁移版本标记已经保证只跑一次，这张表留作回滚点。
    database.exec(`create table if not exists ${calendarSourceNameMergePolicy.backupTable} as select * from ${table}`)
    const rowsOf = database.prepare(`select * from ${table}
      where country_code = ? and source_provider_id = ?
        and ${identityExpr} = ? and period_key = ?
      order by scheduled_date asc, observed_at asc`)
    const updateKept = database.prepare(`update ${table} set
        source_label = ?, source_label_en = ?, values_json = ?, status = ?, value_state = ?,
        importance = coalesce(importance, ?), event_type = coalesce(event_type, ?),
        series_id = coalesce(series_id, ?), first_published_actual = coalesce(first_published_actual, ?),
        first_published_previous = coalesce(first_published_previous, ?),
        observed_at = ?, first_seen_at = ?, data_observed_at = coalesce(data_observed_at, ?),
        release_count = ?, release_dates_json = ?
      where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ?`)
    const deleteRow = database.prepare(`delete from ${table}
      where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ?`)
    const repointLedger = database.prepare(`update ${ledger}
      set country_code = ?, metric_key = ?, period_key = ?, first_scheduled_date = ?
      where provider_id = ? and source_event_id = ?`)
    for (const group of groups) {
      const rows = rowsOf.all(group.country_code, group.source_provider_id, group.identity, group.period_key) as unknown as Row[]
      if (rows.length < 2) continue
      // 留哪一行：状态最强 → 中文名优先（显示名用中文，英文原文进 `source_label_en`）。
      const bestRank = Math.max(...rows.map(rankOf))
      const strongest = rows.filter((row) => rankOf(row) === bestRank)
      const keeper = strongest.find((row) => hasCjk(String(row.source_label ?? ''))) ?? strongest[0]!
      const others = rows.filter((row) => row !== keeper)
      const english = others.find((row) => !hasCjk(String(row.source_label ?? '')))
        ?? rows.find((row) => !hasCjk(String(row.source_label ?? '')))
      let values = String(keeper.values_json ?? '{}')
      for (const row of others) values = unionValues(values, String(row.values_json ?? '{}'))
      const scheduledDates = [...new Set(rows.map((row) => String(row.scheduled_date)))].sort()
      const observedAt = rows.map((row) => String(row.observed_at)).sort().at(-1) ?? String(keeper.observed_at)
      const firstSeenAt = rows.map((row) => String(row.first_seen_at)).sort()[0] ?? String(keeper.first_seen_at)
      const firstPublishedActual = rows.map((row) => row.first_published_actual)
        .find((value) => value !== null && String(value).trim() !== '') ?? null
      const firstPublishedPrevious = rows.map((row) => row.first_published_previous)
        .find((value) => value !== null && String(value).trim() !== '') ?? null
      const dataObservedAt = rows.map((row) => row.data_observed_at)
        .filter((value) => value !== null && String(value).trim() !== '').sort().at(-1) ?? null
      const importance = rows.map((row) => row.importance).find((value) => value !== null) ?? null
      const eventType = rows.map((row) => row.event_type).find((value) => value !== null) ?? null
      const seriesId = rows.map((row) => row.series_id).find((value) => value !== null) ?? null
      const englishName = english === undefined ? null : String(english.source_label ?? '')
      updateKept.run(
        keeper.source_label, englishName, values, keeper.status, keeper.value_state,
        importance, eventType, seriesId, firstPublishedActual, firstPublishedPrevious,
        // **观测时刻取最晚**：新鲜度判定的唯一读取值就是它，合并不许把最新观察时间改早。
        observedAt, firstSeenAt, dataObservedAt,
        scheduledDates.length, JSON.stringify(scheduledDates),
        group.country_code, String(keeper.metric_key), String(keeper.period_key), String(keeper.first_scheduled_date)
      )
      if (englishName !== null && englishName.trim() !== '') report.englishNameStored += 1
      for (const row of others) {
        const repointed = repointLedger.run(group.country_code, String(keeper.metric_key), String(keeper.period_key),
          String(keeper.first_scheduled_date), group.source_provider_id, String(row.source_event_id))
        report.ledgerRewritten += Number(repointed.changes)
        deleteRow.run(group.country_code, String(row.metric_key), String(row.period_key), String(row.first_scheduled_date))
        report.removedRows += 1
      }
      report.mergedGroups += 1
    }
    const after = Number((database.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n)
    if (after !== before - report.removedRows) {
      throw new Error(`source-name merge row count mismatch: before=${before} after=${after} removed=${report.removedRows}`)
    }
    database.prepare('insert or ignore into mi_macro_calendar_migrations(version) values (?)').run(version)
    database.exec('commit')
    return report
  } catch (error) {
    database.exec('rollback')
    throw error
  }
}
