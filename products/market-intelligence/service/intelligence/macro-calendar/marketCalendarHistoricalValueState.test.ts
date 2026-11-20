import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { fillHistoricalReleaseValues } from './marketCalendarHistoricalValueFill'
import { ensureCalendarStandardTables, upsertCalendarStandardRow } from './marketCalendarStandardTable'

/**
 * **历史补值不许「标了有值其实没数」**（Chief 2026-11-19）。
 *
 * 事故形状：`update ... set status='published', value_state='present'` 是**无条件**的，
 * 于是 FRED `pc1` 返回空值的那一期（CPI 2026-10）也被标成「已发布 + 有值」。
 */
const seed = (database: DatabaseSync) => {
  ensureCalendarStandardTables(database)
  upsertCalendarStandardRow(database, {
    countryCode: 'US', metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-10',
    scheduledDate: '2026-11-10', scheduledAt: '2026-11-10T12:30:00.000Z', timePrecision: 'minute',
    valuesJson: '{}', sourceProviderId: 'probe', sourceEventId: 'probe-1', parserVersion: 'probe',
    observedAt: '2026-11-10T13:00:00.000Z', firstSeenAt: '2026-11-10T13:00:00.000Z',
    identityKind: 'code', status: 'missing'
  })
}
const rowOf = (database: DatabaseSync) =>
  database.prepare(`select status, value_state, values_json from mi_calendar_events
    where metric_key = 'US.CPI.NSA.YOY'`).get() as
    { status: string; value_state: string; values_json: string }

describe('历史补值：拿到空值不许标成有值', () => {
  it('读到空值 → value_state=missing，且 status 不被推进到 published', async () => {
    const database = new DatabaseSync(':memory:')
    seed(database)
    await fillHistoricalReleaseValues(database, {
      today: '2026-11-19', nowMs: Date.parse('2026-11-19T00:00:00.000Z'),
      readLatest: async () => ({ period: '2026-10', value: '' })
    })
    expect(rowOf(database)).toMatchObject({ value_state: 'missing' })
    expect(rowOf(database).status).not.toBe('published')
  })

  it('读到真值 → present，并把 status 推进到 published', async () => {
    const database = new DatabaseSync(':memory:')
    seed(database)
    await fillHistoricalReleaseValues(database, {
      today: '2026-11-19', nowMs: Date.parse('2026-11-19T00:00:00.000Z'),
      readLatest: async () => ({ period: '2026-10', value: '3.73' })
    })
    expect(rowOf(database)).toMatchObject({ value_state: 'present', status: 'published' })
    expect(JSON.parse(rowOf(database).values_json).actual).toBe('3.73')
  })
})
