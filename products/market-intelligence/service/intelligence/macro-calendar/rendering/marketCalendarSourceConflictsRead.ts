import type { DatabaseSync } from 'node:sqlite'

import { zeroXRouterIndicatorIdentities } from '../marketCalendarMetricIdentity'
import { zeroXRouterSourceMetricMappings } from '../marketCalendarZeroXRouterSourceMappings'
import { germanSourceMetricMappings } from '../marketCalendarGermanSourceMappings'

/**
 * **跨源比较前要归一三件：期次、身份、量纲**（用户 2026-11-17）。少一件就是假冲突：
 * 期次（拿发布时刻当月）、身份（数组身份与规范码分不到一组）、量纲（单位没入库，`#57`）。
 *
 * 身份归一在这里做：数组身份先按映射表解到规范码，**解不出的要报数**（`unresolvedIds`），
 * 不许静默留在原身份上——那会变成「看起来比较过了，其实只剩一家」。
 */
function resolveMetricKey(metricKey: string): { code: string; resolved: boolean } {
  const match = /^\["(\d+)"/.exec(metricKey)
  if (match === null) return { code: metricKey, resolved: true }
  const sourceId = match[1]!
  const entry = zeroXRouterIndicatorIdentities[sourceId] ?? zeroXRouterSourceMetricMappings[sourceId]
    ?? germanSourceMetricMappings[sourceId]
  return entry === undefined ? { code: metricKey, resolved: false } : { code: entry.metricKey, resolved: true }
}

/**
 * **#40 的读口：同一发布日、同一字段、两侧都有值且不相等 → 并列 + 标记**（用户 2026-11-17 定）。
 *
 * 三条边界写死在这里，界面只管显示：
 * - **不判对错、不挑一个**：期次不可跨源比较（#56）、来源单位没入库（#57），现在判「谁对」是假判断；
 * - **一侧缺值不算冲突**：那是「源未给出」，与「两家不一致」是两件事，混在一起标记会天天空亮；
 * - **配对键是 `scheduled_date`**：`period_key` 跨源根本不可比（narwhal 记统计月、0xrouter 记发布时刻）。
 *
 * 只按字段**并列**给出，不做优先级取值——取哪一个是产品口径的事，读口不替它决定。
 */
export type SourceConflictField = 'actual' | 'consensus' | 'previous'

export type SourceConflict = Readonly<{
  metricKey: string
  /** **同一期次**的冲突才叫不一致；期次不同是两条发布，不是冲突。 */
  periodKey: string
  countryCode: string
  scheduledDate: string
  field: SourceConflictField
  /** 每个来源给了什么：`{ providerId: value }`，只含**真的有值**的来源。 */
  values: Readonly<Record<string, string>>
}>

export type SourceConflictsRead = Readonly<{
  state: 'available'
  scheduledDate: string
  conflicts: readonly SourceConflict[]
  /** 参与判定的多来源组数（同一身份同一日、来源 ≥2），用来判断「标记是不是天天亮」。 */
  multiSourceGroups: number
  /** **身份解不出映射的 id 数**：不为 0 就说明这轮比较不完整（不许静默留在原身份上）。 */
  unresolvedIds: number
}> | Readonly<{ state: 'unavailable'; reasonCode: 'query-input-invalid' | 'query-unavailable' }>

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

function valuesOf(json: unknown): Record<SourceConflictField, string | null> {
  if (typeof json !== 'string') return { actual: null, consensus: null, previous: null }
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>
    return { actual: textOf(parsed.actual), consensus: textOf(parsed.consensus), previous: textOf(parsed.previous) }
  } catch { return { actual: null, consensus: null, previous: null } }
}

export function readSourceValueConflicts(database: DatabaseSync, input: Readonly<{ scheduledDate: unknown }>): SourceConflictsRead {
  if (typeof input.scheduledDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledDate)) {
    return { state: 'unavailable', reasonCode: 'query-input-invalid' }
  }
  const scheduledDate = input.scheduledDate
  try {
    const rows = database.prepare(`select country_code, metric_key, period_key, scheduled_date, source_provider_id, values_json
      from mi_calendar_events where row_kind = 'release' and scheduled_date = ?
      order by metric_key asc, source_provider_id asc`).all(scheduledDate) as unknown as Record<string, unknown>[]
        // **分组键必须含期次**：标准表主键是 `(国家, 指标码, 期次, 首发布日)`，所以「同一期次同一身份」
    // 只可能有一行——不同期次的数不是「两个来源给了不同值」，是**两条不同期的发布**。
    // 少了期次，11-06 那两条（narwhal 记 `2026-09`、0xrouter 记 `2026-10`）会被并列成「不一致」，
    // 那是凭空造出「同一期有两个值」这个事实（`#56` 期次不可跨源比较）。
    const unresolvedIds = new Set<string>()
    const groups = new Map<string, Record<string, Record<SourceConflictField, string | null>>>()
    for (const row of rows) {
      const identity = resolveMetricKey(String(row.metric_key))
      if (!identity.resolved) unresolvedIds.add(String(row.metric_key))
      const key = `${String(row.country_code)}|${identity.code}|${String(row.period_key)}`
      const byProvider = groups.get(key) ?? {}
      byProvider[String(row.source_provider_id)] = valuesOf(row.values_json)
      groups.set(key, byProvider)
    }
    const conflicts: SourceConflict[] = []
    let multiSourceGroups = 0
    for (const [key, byProvider] of groups) {
      const providerIds = Object.keys(byProvider)
      if (providerIds.length < 2) continue
      multiSourceGroups += 1
      const [countryCode, metricKey, periodKey] = key.split('|') as [string, string, string]
      for (const field of ['actual', 'consensus', 'previous'] as const) {
        const values: Record<string, string> = {}
        for (const providerId of providerIds) {
          const value = byProvider[providerId]?.[field]
          if (value !== null && value !== undefined) values[providerId] = value
        }
        // **一侧缺值不算冲突**：只有两家都给了、且不相等，才是「多源不一致」。
        if (Object.keys(values).length < 2) continue
        if (new Set(Object.values(values)).size < 2) continue
        conflicts.push(Object.freeze({ metricKey, periodKey, countryCode, scheduledDate, field,
          values: Object.freeze(values) }))
      }
    }
    return Object.freeze({ state: 'available' as const, scheduledDate,
      conflicts: Object.freeze(conflicts), multiSourceGroups, unresolvedIds: unresolvedIds.size })
  } catch { return { state: 'unavailable', reasonCode: 'query-unavailable' } }
}
