import type { DatabaseSync } from 'node:sqlite'

import type { CodeStatus, CodeTableRow, NotBuiltReason, OfficialSource, PendingReason } from '../marketCalendarCodeTable'
import { marketCalendarCodeTable } from '../marketCalendarCodeTable'
import { marketCalendarCountryCodeTable } from '../marketCalendarCountryCodeTable'
import { marketCalendarCountryNames } from '../marketCalendarDisplayNameTables'
import { zeroXRouterEventIdentities } from '../marketCalendarEventIdentities'
import { zeroXRouterIndicatorIdentities } from '../marketCalendarMetricIdentity'
import { zeroXRouterSourceMetricMappings } from '../marketCalendarZeroXRouterSourceMappings'
import { germanSourceMetricMappings } from '../marketCalendarGermanSourceMappings'

/**
 * **码表页签的只读读口**（用户 2026-11-17：弹框两个页签「码表 / 未映射」，已映射整个拿掉）。
 *
 * 一次下发整表（244 行，量小，不做游标翻页）；每行带：
 * - 码 / 中英名 / 分级 / 口径（测度 + 季调）/ 状态；
 * - **官网页**：要么是机构页（带 `verifiedAt` 与 `basis`），要么是 `pending` + 闭集理由——
 *   **绝不下发空链接**，空链接会被读成「这个码没有官网页」；
 * - `sourceIdCount`：**有多少个源内 id 认得这个码**（不下发 id 列表，页签只需要看出「有没有源认它」）。
 */
export type CodeTableReadRow = Readonly<{
  code: string
  kind: CodeTableRow['kind']
  names: CodeTableRow['names']
  /**
   * 国家码（`US`/`DE`/`EMU`）；没有国家的事件写 null，不猜。**读口一定会给**；类型上可缺是为了兼容
   * 还没跟上这条形状的旧夹具——界面缺这两个字段就不显示国家列，不画一个空列。
   */
  countryCode: string | null
  /** 国家名的**中文**写法，取自现有国名表——渲染层不许自己拼，否则同一国家会有两种写法。 */
  countryName: string | null
  /** 完整国名（`United States`）：给 `title` / `aria-label`，英文下显示代码、读屏念全名。 */
  countryNameFull?: string | null
  tier: CodeTableRow['tier']
  measure: string | null
  seasonality: string | null
  status: CodeStatus
  /** 状态理由（闭集）；`active` 为 null。 */
  reason: NotBuiltReason | PendingReason | null
  officialSource: OfficialSource | Readonly<{ pending: true; reason: PendingReason }>
  /** **认得这个码的源内 id 个数**（不是数据量：两者回答不同问题，界面上挨着摆、标签各写各的）。 */
  sourceIdCount: number
  /**
   * **这个码在库里有多少条发布数据**（用户 2026-11-17 定）：标准表里 `row_kind = 'release'` 且
   * `metric_key` 等于它的行数。
   *
   * 为什么不是观测行数：观测表是**审计流水**（每批每源一行），同一期反复采集会多行，数出来是
   * 「我们采过几次」；为什么不是源内 id 数：那回答的是「认得几个旧源 id」，与数据量无关
   * （早前按源内 id 数，85 条规则全是 0）。一条发布一行、多源合并后不重复，才是读者问的那个数。
   * `row_kind` 过滤保留：GDP nowcast 那类随时更新的估算不是「发布」。
   */
  releaseRowCount: number
}>

export type CodeTableRead = Readonly<{
  state: 'available'
  rows: readonly CodeTableReadRow[]
  counts: Readonly<{ total: number; metric: number; event: number; withOfficialSource: number; pendingOfficialSource: number }>
}> | Readonly<{ state: 'unavailable'; reasonCode: 'query-unavailable' }>

/** 这个码被多少个源内 id 认得（三张指标映射表 + 事件表）。 */
function sourceIdCounts(): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  const bump = (metricKey: string): void => {
    counts.set(metricKey, (counts.get(metricKey) ?? 0) + 1)
  }
  for (const entry of Object.values(zeroXRouterIndicatorIdentities)) bump(entry.metricKey)
  for (const entry of Object.values(zeroXRouterSourceMetricMappings)) bump(entry.metricKey)
  for (const entry of Object.values(germanSourceMetricMappings)) bump(entry.metricKey)
  for (const entry of Object.values(zeroXRouterEventIdentities)) bump(entry.metricKey)
  return counts
}

/**
 * @param locale 界面语言。**英文下一律显示两位代码**（`US`/`JP`/`CA`，用户 2026-11-21 定），
 * 与事件列表那格一致；中文显示中文名。**完整国名不丢**，放在 `countryNameFull` 里供
 * `title` / `aria-label` 使用——全产品只有一条规则：**英文看代码，全名只在悬停/读屏**。
 * 谁也别为某一处单独改回全名，那会让两处又不一致。
 */
export function readCalendarCodeTable(database: DatabaseSync, locale: 'zh' | 'en' = 'zh'): CodeTableRead {
  try {
    const counts = sourceIdCounts()
    // 一个码一条发布算一行。
    //
    // **表还没建**（新库、一次都没采过）不是「读不到」：那是「库里确实还没有数据」，一律按 0。
    // 真读失败（锁、IO）会让 `prepare/all` 抛出去 → 外层 catch → 整表 unavailable，两者不混。
    const releaseRows = new Map<string, number>()
    const hasEventsTable = database.prepare(
      `select name from sqlite_master where type = 'table' and name = 'mi_calendar_events'`
    ).get() !== undefined
    if (hasEventsTable) {
      for (const row of database.prepare(
        `select metric_key, count(*) as n from mi_calendar_events where row_kind = 'release' group by metric_key`
      ).all() as unknown as { metric_key: string; n: number }[]) {
        releaseRows.set(row.metric_key, Number(row.n))
      }
    }
    // **两张表并成一个视图**：244 条既有码 + 603 条按国家新建的码，同一个码只出现一次。
    const mergedRows = { ...marketCalendarCodeTable, ...marketCalendarCountryCodeTable }
    const rows: CodeTableReadRow[] = Object.values(mergedRows)
      .sort((left, right) => left.code.localeCompare(right.code))
      .map((row) => Object.freeze({
        code: row.code,
        kind: row.kind,
        names: row.names,
        countryCode: row.countryCode,
        // `EMU` 是我们唯一的非 ISO 例外（欧元区没有 alpha-2）：国名复用 `EU` 那一条，
      // 不在国名表里复制第二份（那份表有「一个名字只对应一个码」的守卫）。
      countryName: row.countryCode === null ? null
        : (() => {
          const names = marketCalendarCountryNames[row.countryCode === 'EMU' ? 'EU' : row.countryCode]
          if (names === undefined) return null
          return locale === 'en' ? names.en : names.zh
        })(),
        countryNameFull: row.countryCode === null ? null
          : (marketCalendarCountryNames[row.countryCode === 'EMU' ? 'EU' : row.countryCode]?.enFull ?? null),
        tier: row.tier,
        // 事件行没有测度与季调档：给 null，不编一个「LEVEL」。
        measure: row.kind === 'metric' ? row.measure : null,
        seasonality: row.kind === 'metric' ? row.seasonality : null,
        status: row.status,
        reason: row.reason ?? null,
        officialSource: row.officialSource,
        sourceIdCount: counts.get(row.code) ?? 0,
        releaseRowCount: releaseRows.get(row.code) ?? 0
      }))
    const withOfficialSource = rows.filter((row) => !('pending' in row.officialSource)).length
    return Object.freeze({
      state: 'available' as const,
      rows: Object.freeze(rows),
      counts: Object.freeze({
        total: rows.length,
        metric: rows.filter((row) => row.kind === 'metric').length,
        event: rows.filter((row) => row.kind === 'event').length,
        withOfficialSource,
        pendingOfficialSource: rows.length - withOfficialSource
      })
    })
  } catch { return { state: 'unavailable', reasonCode: 'query-unavailable' } }
}
