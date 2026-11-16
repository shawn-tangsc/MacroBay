import type { DatabaseSync } from 'node:sqlite'

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
    const rows = database.prepare(`select country_code, metric_key, scheduled_date, source_provider_id, values_json
      from mi_calendar_events where row_kind = 'release' and scheduled_date = ?
      order by metric_key asc, source_provider_id asc`).all(scheduledDate) as unknown as Record<string, unknown>[]
    const groups = new Map<string, Record<string, Record<SourceConflictField, string | null>>>()
    for (const row of rows) {
      const key = `${String(row.country_code)}|${String(row.metric_key)}`
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
      const metricKey = key.slice(key.indexOf('|') + 1)
      for (const field of ['actual', 'consensus', 'previous'] as const) {
        const values: Record<string, string> = {}
        for (const providerId of providerIds) {
          const value = byProvider[providerId]?.[field]
          if (value !== null && value !== undefined) values[providerId] = value
        }
        // **一侧缺值不算冲突**：只有两家都给了、且不相等，才是「多源不一致」。
        if (Object.keys(values).length < 2) continue
        if (new Set(Object.values(values)).size < 2) continue
        conflicts.push(Object.freeze({ metricKey, scheduledDate, field, values: Object.freeze(values) }))
      }
    }
    return Object.freeze({ state: 'available' as const, scheduledDate,
      conflicts: Object.freeze(conflicts), multiSourceGroups })
  } catch { return { state: 'unavailable', reasonCode: 'query-unavailable' } }
}
