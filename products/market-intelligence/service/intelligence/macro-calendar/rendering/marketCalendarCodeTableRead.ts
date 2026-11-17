import type { DatabaseSync } from 'node:sqlite'

import type { CodeStatus, CodeTableRow, NotBuiltReason, OfficialSource, PendingReason } from '../marketCalendarCodeTable'
import { marketCalendarCodeTable } from '../marketCalendarCodeTable'
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
  tier: CodeTableRow['tier']
  measure: string | null
  seasonality: string | null
  status: CodeStatus
  /** 状态理由（闭集）；`active` 为 null。 */
  reason: NotBuiltReason | PendingReason | null
  officialSource: OfficialSource | Readonly<{ pending: true; reason: PendingReason }>
  sourceIdCount: number
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

export function readCalendarCodeTable(_database: DatabaseSync): CodeTableRead {
  try {
    const counts = sourceIdCounts()
    const rows: CodeTableReadRow[] = Object.values(marketCalendarCodeTable)
      .sort((left, right) => left.code.localeCompare(right.code))
      .map((row) => Object.freeze({
        code: row.code,
        kind: row.kind,
        names: row.names,
        countryCode: row.countryCode,
        countryName: row.countryCode === null ? null : (marketCalendarCountryNames[row.countryCode]?.zh ?? null),
        tier: row.tier,
        // 事件行没有测度与季调档：给 null，不编一个「LEVEL」。
        measure: row.kind === 'metric' ? row.measure : null,
        seasonality: row.kind === 'metric' ? row.seasonality : null,
        status: row.status,
        reason: row.reason ?? null,
        officialSource: row.officialSource,
        sourceIdCount: counts.get(row.code) ?? 0
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
