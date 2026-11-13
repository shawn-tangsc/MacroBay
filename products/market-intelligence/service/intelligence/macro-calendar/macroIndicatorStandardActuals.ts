import type { DatabaseSync } from 'node:sqlite'

import { calendarStandardTablePolicy } from './marketCalendarStandardTable'

/**
 * 同一期同一天有多行时，**本期值取有 actual 的那行**。
 *
 * 10 月那批是回填进来的：官方 feed 的行只有排期（`{}`），旧源那行才有 `actual`。
 * 卡片若只认「最新那一行」，就会读到官方空行、显示「未提供」，而值其实就在隔壁那行。
 *
 * 规则（用户 2026-11-14 定）：有值的那行优先；都有值取观测最新；都空才算没值。
 */
export type StandardActual = Readonly<{
  period?: string
  releasedAt: string
  observedAt: string
  providerId: string
  actual: string
}>

export function readStandardActuals(database: DatabaseSync, input: Readonly<{
  metricKey: string
  asOf: string
}>): readonly StandardActual[] {
  const rows = database.prepare(`select period_key, scheduled_date, scheduled_at, observed_at, source_provider_id, values_json
    from ${calendarStandardTablePolicy.releasesView}
    where metric_key = ? and scheduled_date <= ?
      and values_json like '%"actual"%'
    order by scheduled_date desc, observed_at desc
    limit 8`).all(input.metricKey, input.asOf.slice(0, 10)) as Record<string, unknown>[]
  return rows.flatMap((row) => {
    const actual = readJsonString(row.values_json, 'actual')
    if (actual === undefined) return []
    return [{
      ...(typeof row.period_key === 'string' ? { period: row.period_key } : {}),
      releasedAt: typeof row.scheduled_at === 'string' ? row.scheduled_at : `${String(row.scheduled_date)}T00:00:00.000Z`,
      observedAt: typeof row.observed_at === 'string' ? row.observed_at : '',
      providerId: typeof row.source_provider_id === 'string' ? row.source_provider_id : '',
      actual
    }]
  })
}

function readJsonString(json: unknown, key: string): string | undefined {
  if (typeof json !== 'string') return undefined
  try {
    const value = (JSON.parse(json) as Record<string, unknown>)[key]
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}
