import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import {
  ensureCalendarStandardTables, findCalendarStandardRowBySource, recordCalendarUnmapped, upsertCalendarStandardRow,
  type CalendarStandardRow
} from './marketCalendarStandardTable'

const base: CalendarStandardRow = {
  countryCode: 'USA', metricKey: 'US.NONFARM.SA.CHANGE', periodKey: '2026-10',
  scheduledDate: '2026-11-06', scheduledAt: '2026-11-06T13:30:00.000Z', timePrecision: 'minute',
  valuesJson: JSON.stringify({ actual: '165', previous: '29' }), sourceProviderId: 'narwhal',
  sourceEventId: 'r-1', parserVersion: 'v1', observedAt: '2026-11-06T13:31:00.000Z',
  firstSeenAt: '2026-11-06T13:31:00.000Z', firstPublishedActual: '165', firstPublishedPrevious: '29'
}

const rows = (database: DatabaseSync) =>
  database.prepare('select * from mi_calendar_events').all() as Record<string, unknown>[]

describe('标准日历表', () => {
  it('一身份一行：同身份再写是覆盖，不是新增', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, base)
    upsertCalendarStandardRow(database, { ...base, observedAt: '2026-11-13T09:00:00.000Z' })
    expect(rows(database)).toHaveLength(1)
  })

  it('修订覆盖值，但首发布值冻结（非农 29 不会被 60 冲掉）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, base)
    // 来源修订：previous 从 29 变 60，observed_at 也更新。
    upsertCalendarStandardRow(database, { ...base,
      valuesJson: JSON.stringify({ actual: '165', previous: '60' }),
      observedAt: '2026-11-13T09:00:00.000Z',
      firstPublishedActual: '165', firstPublishedPrevious: '60' })
    const [row] = rows(database)
    expect(JSON.parse(String(row!.values_json)).previous).toBe('60')  // 值跟着修订走
    expect(row!.first_published_previous).toBe('29')                  // 首发布值冻结
    expect(row!.first_published_actual).toBe('165')
    expect(row!.first_seen_at).toBe(base.firstSeenAt)                 // 首见时间也不动
    expect(row!.observed_at).toBe('2026-11-13T09:00:00.000Z')         // 观测时间跟着走
  })

  it('没映射上的行进 unmapped、不进日历，且重复记录幂等', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const entry = { providerId: 'narwhal', sourceKey: 'r-2', detectedAt: '2026-11-13T09:00:00.000Z',
      rawJson: '{"name":"unknown"}', reason: 'unknown-measure' as const }
    recordCalendarUnmapped(database, entry)
    recordCalendarUnmapped(database, entry)
    expect((database.prepare('select count(*) c from mi_calendar_unmapped').get() as { c: number }).c).toBe(1)
    expect(rows(database)).toHaveLength(0)
  })
})

describe('一次发布一行：四次判红口径', () => {
  const write = (database: DatabaseSync, over: Partial<CalendarStandardRow>) =>
    upsertCalendarStandardRow(database, { ...base, ...over })

  it('同一期间两次真实发布（初值 11-06 / 终值 11-20）→ 两行', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    write(database, { sourceEventId: 'r-prelim', scheduledAt: '2026-11-06T15:00:00.000Z' })
    write(database, { sourceEventId: 'r-final', scheduledAt: '2026-11-20T15:00:00.000Z' })
    expect(rows(database)).toHaveLength(2)
  })

  it('同一发布修订 → 仍一行，且其次发布时刻不变', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    write(database, {})
    write(database, { valuesJson: JSON.stringify({ actual: '165', previous: '60' }),
      observedAt: '2026-11-13T09:00:00.000Z' })
    const [row] = rows(database)
    expect(rows(database)).toHaveLength(1)
    expect(row!.first_scheduled_at).toBe(base.scheduledAt)
  })

  it('源改期（同源同 source_event_id）→ 仍一行，显示时刻跟着变', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    write(database, {})
    const found = findCalendarStandardRowBySource(database, { sourceProviderId: 'narwhal', sourceEventId: 'r-1' })!
    write(database, { scheduledAt: '2026-11-07T13:30:00.000Z', firstScheduledAt: found.firstScheduledAt })
    const [row] = rows(database)
    expect(rows(database)).toHaveLength(1)
    expect(row!.scheduled_at).toBe('2026-11-07T13:30:00.000Z')
    expect(row!.first_scheduled_at).toBe(base.scheduledAt)
  })
})
