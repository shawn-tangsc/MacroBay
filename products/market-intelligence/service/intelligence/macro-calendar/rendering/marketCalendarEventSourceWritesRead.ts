import type { DatabaseSync } from 'node:sqlite'

import { zeroXRouterIndicatorIdentities } from '../marketCalendarMetricIdentity'
import { zeroXRouterSourceMetricMappings } from '../marketCalendarZeroXRouterSourceMappings'
import { germanSourceMetricMappings } from '../marketCalendarGermanSourceMappings'

/**
 * **按事件身份取「各来源写了什么」**（用户 2026-11-17 定，`#40` 与 `#47` 共用）。
 *
 * **必须双源读**，只读一张表都做不出验收样本：
 * - **修订表**回答「谁在什么时候写过什么」——但它只有官方来源（BLS/BEA/Fed 共 123 行），
 *   `narwhal`、`0xrouter` 一条都没有；
 * - **标准表**回答「这个身份现在每个来源各是什么值」——市场来源只在这里，且**只有当前状态、没有历史**。
 *
 * 每行带 `source: 'revision' | 'observation'`，让界面能说清「这行是写入记录」还是「这行是当前观测」，
 * 不把两者混成一句「某人某时写过」。
 */
export type EventSourceWriteRow = Readonly<{
  source: 'revision' | 'observation'
  providerId: string
  /** 写入/观测时刻（UTC）。 */
  observedAt: string
  status: string
  consensus: string | null
  actual: string | null
  previous: string | null
  /** 这一行自己的身份写法：市场来源可能仍是数组身份（映射未落前）。 */
  identityKey: string
}>

export type EventSourceWritesRead = Readonly<{
  state: 'available'
  metricKey: string
  rows: readonly EventSourceWriteRow[]
  /** 有几个不同来源（去重）。 */
  providerCount: number
  /** 只有一行来源有值时，界面不该暗示「多源对照」。 */
  hasRevisionChain: boolean
}>
  | Readonly<{ state: 'unavailable'; reasonCode: 'query-input-invalid' | 'query-unavailable' }>

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

/** 修订表里的值是 `{ displayValue }` 形状；标准表是裸字符串。统一成显示串。 */
function displayOf(json: string | null): string | null {
  if (json === null) return null
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>
    const show = textOf(parsed.displayValue)
    return show ?? textOf(json)
  } catch { return textOf(json) }
}

function valuesOfStandard(json: unknown): Readonly<{ consensus: string | null; actual: string | null; previous: string | null }> {
  if (typeof json !== 'string') return { consensus: null, actual: null, previous: null }
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>
    return { consensus: textOf(parsed.consensus), actual: textOf(parsed.actual), previous: textOf(parsed.previous) }
  } catch { return { consensus: null, actual: null, previous: null } }
}

/** 这个指标码在映射表里认得哪些数组身份（用来把市场来源的行找出来）。 */
function sourceIdsFor(metricKey: string): string[] {
  const ids = [
    ...Object.entries(zeroXRouterIndicatorIdentities),
    ...Object.entries(zeroXRouterSourceMetricMappings),
    ...Object.entries(germanSourceMetricMappings)
  ].filter(([, entry]) => entry.metricKey === metricKey).map(([sourceId]) => sourceId)
  return ids
}

/**
 * `scheduledDate`（`YYYY-MM-DD`）是**必需**的：没有它，这个读口会把这个指标的**所有月份**都返回——
 * 点开 11 月那期，10 月、9 月的写入记录会一起出来，两块变几十块。详情行上的
 * `MarketCalendarEvent.scheduledAt` 的日期部分就是它，不需要新字段。
 */
export function readEventSourceWrites(database: DatabaseSync, input: Readonly<{
  metricKey: unknown
  scheduledDate: unknown
}>): EventSourceWritesRead {
  if (typeof input.metricKey !== 'string' || input.metricKey.trim() === ''
    || typeof input.scheduledDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledDate)) {
    return { state: 'unavailable', reasonCode: 'query-input-invalid' }
  }
  const metricKey = input.metricKey.trim()
  const scheduledDate = input.scheduledDate
  try {
    const rows: EventSourceWriteRow[] = []
    // ① 修订表：官方来源的写入记录（Who wrote what, when）——**没有历史补不回来**。
    for (const row of database.prepare(`select provider_id, scheduled_date, lifecycle_state, consensus_json,
        actual_json, previous_json from mi_macro_calendar_revisions
        where event_key = ? and scheduled_date = ? order by detected_at desc`)
      .all(metricKey, scheduledDate) as unknown as Record<string, unknown>[]) {
      rows.push(Object.freeze({
        source: 'revision' as const,
        providerId: String(row.provider_id),
        observedAt: String(row.scheduled_date),
        status: String(row.lifecycle_state),
        consensus: displayOf(row.consensus_json as string | null),
        actual: displayOf(row.actual_json as string | null),
        previous: displayOf(row.previous_json as string | null),
        identityKey: metricKey
      }))
    }
    // ② 标准表：**当前**各来源的值（市场来源只在这里，没有历史）。
    const sourceIds = sourceIdsFor(metricKey)
    const identityClause = ['metric_key = ?', ...sourceIds.map(() => 'metric_key like ?')].join(' or ')
    // 参数顺序跟 SQL 里的占位符顺序一致：先 `scheduled_date`（在 identity 子句之前），再 identity。
    const params: string[] = [scheduledDate, metricKey, ...sourceIds.map((id) => `["${id}",%`)]
    for (const row of database.prepare(`select metric_key, source_provider_id, observed_at, status, values_json
        from mi_calendar_events where row_kind = 'release' and scheduled_date = ? and (${identityClause})
        order by observed_at desc`).all(...params) as unknown as Record<string, unknown>[]) {
      rows.push(Object.freeze({
        source: 'observation' as const,
        providerId: String(row.source_provider_id),
        observedAt: String(row.observed_at),
        status: String(row.status),
        ...valuesOfStandard(row.values_json),
        identityKey: String(row.metric_key)
      }))
    }
    if (rows.length === 0) return { state: 'unavailable', reasonCode: 'query-unavailable' }
    return Object.freeze({
      state: 'available' as const,
      metricKey,
      rows: Object.freeze(rows),
      providerCount: new Set(rows.map((row) => row.providerId)).size,
      hasRevisionChain: rows.some((row) => row.source === 'revision')
    })
  } catch { return { state: 'unavailable', reasonCode: 'query-unavailable' } }
}
