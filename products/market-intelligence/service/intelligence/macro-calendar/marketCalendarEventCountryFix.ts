import type { DatabaseSync } from 'node:sqlite'

import { calendarStandardTablePolicy, hasActualValue } from './marketCalendarStandardTable'

/**
 * **事件行的国家值修正：每次启动都跑的一条长期规则**（用户 2026-11-19 定）。
 *
 * 起因：事件型行的国家是源按「在哪讲/谁的场子」硬塞的，双向都错——`纽约联储主席威廉姆斯讲话`
 * 挂在 DE 下，`拉加德/连恩讲话` 挂在 US 下。国家**按机构归属**，不按开会地点（15 号文档 §八）。
 *
 * 这条规则原来写成了一次性迁移（版本 19 记进 `mi_macro_calendar_migrations` 后就短路返回），
 * 于是 11-17 之后新采集的同类事件又按源给的国家落了一批——**长期规则被写成一次性迁移**，
 * 跟「一国两码」是同一类毛病。现在每次启动幂等执行，并且：
 * - 美国写 `US`（与码表、观测表统一）；此前写 `USA` 会在改正时多出一行 `USA` 而不是合并；
 * - 改正后与已有行撞主键（国家+码+期次+首发布日）时按合并规则处理：优先留 `actual` 非空的；
 *   都有或都没有时留**已经是目标国家**的那行（候选行本身就是被改正的重复行）；
 *   被删整行进审计表，记规则分支与保留目标行，可回查。
 *
 * 口径（产品经理定，Chief 采纳）：
 * - 欧洲央行的事件与讲话 → `EMU`（**不是 `EU`**：`EU` 含非欧元国，混用会让「欧元区 CPI」与
 *   「欧盟 CPI」撞成一个身份）；
 * - 美联储的事件与讲话 → `US`；
 * - G7 外长会 → `GLOBAL`（无单一主办机构）；欧洲财金领导人年会 → `EMU`（欧元区财长层面，有机构）；
 * - 公司事件（英伟达 GTC）**不进标准日历**，留给事件类型那笔处理，这里不动它。
 *
 * 只改**事件行**（数组身份）；指标行有发布机构，国家是对的，不动。
 */
export const calendarEventCountryFixPolicy = Object.freeze({
  /** 首次执行前的整表快照（`create if not exists`，之后不再覆盖）。 */
  backupTable: 'mi_calendar_events__country_fix_v19',
  /** 合并删行留底：一行一条，存被删整行 JSON 与保留目标行。 */
  mergeAuditTable: 'mi_calendar_events__merge_audit_v1'
})

/** 源内 id（数组身份第一段）→ 正确国家码。只列核过的，不猜。 */
export const eventCountryFixes: Readonly<Record<string, string>> = Object.freeze({
  // 美联储的讲话挂在 DE 下：按机构归美国
  '45051': 'US',
  // 欧洲央行三位（首席经济学家连恩 ×2、行长拉加德）挂在 US 下：按机构归欧元区
  '45023': 'EMU',
  '45138': 'EMU',
  '45145': 'EMU'
})

export type EventCountryFixReport = Readonly<{
  /** 命中规则且国家不对的候选行数。 */
  scanned: number
  /** 直接改写国家的行数。 */
  updated: number
  /** 撞主键后按合并规则删掉的重复行数（整行进审计表）。 */
  merged: number
  /**
   * 数组身份里**不是合法 JSON** 的行数（读不出来就不按身份处理，但必须计数）。
   * 今天实测 0：`["214790",79090]` 这种写法是合法 JSON（第二段是数字，不需要引号）。
   */
  invalidIdentities: number
  /**
   * 同一身份、同一期仍挂在两个以上国家下的身份（待补清单）。
   * 改正后应为空；不为空说明又冒出一批身份/国家错配，规则表要补。
   */
  ambiguousIdentities: readonly string[]
}>

type CandidateRow = Readonly<{
  row_id: number
  metric_key: string
  period_key: string
  first_scheduled_date: string
  values_json: string
}>

type TwinRow = Readonly<{ row_id: number; values_json: string }>

const mergeAuditSchema = `create table if not exists %TABLE% (
  id integer primary key autoincrement,
  group_country_code text not null,
  group_metric_key text not null,
  group_period_key text not null,
  kept_rowkey text not null,
  rule text not null,
  deleted_row_json text not null,
  deleted_at text not null
)`

function rowKey(countryCode: string, metricKey: string, periodKey: string, firstScheduledDate: string): string {
  return `${countryCode}|${metricKey}|${periodKey}|${firstScheduledDate}`
}

export function fixCalendarEventCountries(database: DatabaseSync): EventCountryFixReport {
  const table = calendarStandardTablePolicy.eventsTable
  const { backupTable, mergeAuditTable } = calendarEventCountryFixPolicy
  database.exec(mergeAuditSchema.replace('%TABLE%', mergeAuditTable))

  const report = { scanned: 0, updated: 0, merged: 0, invalidIdentities: 0 }
  database.exec('begin')
  try {
    // 首次执行前的整表快照；之后每次启动都不再覆盖，保住「规则上线前」的原样。
    database.exec(`create table if not exists ${backupTable} as select * from ${table}`)
    /**
     * 数组身份的 id 取第一段。**旧注释写错了**：`["214790",79090]` 里第二段是数字但整串
     * 是**合法 JSON**（实测真库 1943 行 `json_valid = 1`，`json_extract` 正常），
     * 当初按位置截取是多余的。现在先 `json_valid` 再取 `$[0]`：真的非法时才跳过，
     * 并且**计数**（`invalidIdentities`）——不许静默当成「没有这条身份」。
     */
    const invalidIdentities = Number((database.prepare(`select count(*) as n from ${table}
      where metric_key like '[%' and not json_valid(metric_key)`).get() as { n: number }).n)
    report.invalidIdentities = invalidIdentities
    const findCandidates = database.prepare(`select rowid as row_id, metric_key, period_key,
        first_scheduled_date, values_json
      from ${table}
      where metric_key like '[%'
        and json_valid(metric_key)
        and json_extract(metric_key, '$[0]') = ?
        and country_code <> ?`)
    const findTwin = database.prepare(`select rowid as row_id, values_json from ${table}
      where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ?`)
    const moveCountry = database.prepare(`update ${table} set country_code = ? where rowid = ?`)
    const deleteRow = database.prepare(`delete from ${table} where rowid = ?`)
    const readRow = database.prepare(`select * from ${table} where rowid = ?`)
    const writeAudit = database.prepare(`insert into ${mergeAuditTable}
      (group_country_code, group_metric_key, group_period_key, kept_rowkey, rule, deleted_row_json, deleted_at)
      values (?, ?, ?, ?, ?, ?, ?)`)
    const archive = (rowId: number, group: CandidateRow, countryCode: string, keptRowkey: string, rule: string): void => {
      const row = readRow.get(rowId) as Record<string, unknown>
      writeAudit.run(countryCode, group.metric_key, group.period_key, keptRowkey, rule,
        JSON.stringify(row), new Date().toISOString())
    }

    for (const [sourceId, countryCode] of Object.entries(eventCountryFixes)) {
      const candidates = findCandidates.all(sourceId, countryCode) as CandidateRow[]
      for (const candidate of candidates) {
        report.scanned += 1
        const twin = findTwin.get(countryCode, candidate.metric_key, candidate.period_key,
          candidate.first_scheduled_date) as TwinRow | undefined
        if (twin === undefined) {
          moveCountry.run(countryCode, candidate.row_id)
          report.updated += 1
          continue
        }
        // 撞主键：同一身份、同一期、同一首发布日已经在目标国家下有一行，只能留一条。
        const candidateHasActual = hasActualValue(candidate.values_json)
        const twinHasActual = hasActualValue(twin.values_json)
        const branch = candidateHasActual === twinHasActual ? 'keep-existing-country' : 'actual-priority'
        if (candidateHasActual && !twinHasActual) {
          archive(twin.row_id, candidate, countryCode,
            rowKey(countryCode, candidate.metric_key, candidate.period_key, candidate.first_scheduled_date),
            `event-country-collision/${branch}`)
          deleteRow.run(twin.row_id)
          moveCountry.run(countryCode, candidate.row_id)
          report.updated += 1
        } else {
          archive(candidate.row_id, candidate, countryCode,
            rowKey(countryCode, candidate.metric_key, candidate.period_key, candidate.first_scheduled_date),
            `event-country-collision/${branch}`)
          deleteRow.run(candidate.row_id)
        }
        report.merged += 1
      }
    }

    // 待补清单：改正后仍有身份同一期挂在两个以上国家下，说明规则表漏了，规则要补人的判断。
    const ambiguous = database.prepare(`select metric_key from ${table}
      where metric_key like '[%'
      group by metric_key, period_key, first_scheduled_date
      having count(distinct country_code) > 1
      order by metric_key`).all() as Array<{ metric_key: string }>
    const ambiguousIdentities = [...new Set(ambiguous.map((row) => row.metric_key))]

    database.exec('commit')
    return { ...report, ambiguousIdentities }
  } catch (error) {
    database.exec('rollback')
    throw error
  }
}
