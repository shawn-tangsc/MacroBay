import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { calendarPeriodKeyMergePolicy, mergeMPeriodStandardRows } from './marketCalendarPeriodKeyMerge'
import { isMPeriodKey, normalizeCalendarPeriodKey, normalizeCalendarSourceEventId } from './marketCalendarPeriodKey'
import { ensureCalendarStandardTables, upsertCalendarStandardRow } from './marketCalendarStandardTable'

/**
 * 期次归一 + 历史 `YYYY-MNN` 行的合并（迁移 14）。
 *
 * 这不是「删掉 60 行」：同一期在表里有两个写法，两个都得留信息——有值的留下，`first_published_*`
 * 取先到的，台账那条跟着改到留下的行上。
 */
const now = '2026-11-16T03:00:00.000Z'

function row(metricKey: string, periodKey: string, extra: Partial<Record<string, string | undefined>> = {}) {
  return {
    countryCode: 'USA', metricKey, periodKey, scheduledDate: '2026-11-10', timePrecision: 'date' as const,
    status: 'missing' as const, valuesJson: '{}', sourceProviderId: 'macro-calendar-official-replay',
    sourceEventId: `US.CPI.NSA.YOY.RELEASE.${periodKey}`, parserVersion: 'v1', observedAt: now, firstSeenAt: now,
    ...extra
  }
}

function setup(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  database.exec('create table if not exists mi_macro_calendar_migrations (version integer primary key)')
  return database
}

describe('期次的唯一写法', () => {
  it('`2026-M10` 与 `2026-10` 归到同一个值；不是年月的写法原样保留', () => {
    expect(normalizeCalendarPeriodKey('2026-M10')).toBe('2026-10')
    expect(normalizeCalendarPeriodKey('2026-10')).toBe('2026-10')
    expect(normalizeCalendarPeriodKey('2026-M10')).toBe(normalizeCalendarPeriodKey('2026-10'))
    expect(normalizeCalendarPeriodKey('2026-Q3')).toBe('2026-Q3')
    expect(normalizeCalendarPeriodKey('2026-11-10')).toBe('2026-11-10')
    expect(isMPeriodKey('2026-M10')).toBe(true)
    expect(isMPeriodKey('2026-10')).toBe(false)
    // 来源 id 的期次段同理：同一发布只许有一个 id。
    expect(normalizeCalendarSourceEventId('US.CPI.NSA.YOY.RELEASE.2026-M10')).toBe('US.CPI.NSA.YOY.RELEASE.2026-10')
    expect(normalizeCalendarSourceEventId('US.FOMC.2026-12-09')).toBe('US.FOMC.2026-12-09')
  })
})

describe('历史 YYYY-MNN 行合并（迁移 14）', () => {
  it('有值的那行留下、first_published 取先到的、台账跟着改；第二遍全 0', () => {
    const database = setup()
    // 一对：`2026-M10` 那行有 actual，`2026-10` 那行只有共识。
    upsertCalendarStandardRow(database, row('US.CPI.NSA.YOY', '2026-10', {
      status: 'missing', valuesJson: JSON.stringify({ consensus: '3.5' })
    }))
    upsertCalendarStandardRow(database, row('US.CPI.NSA.YOY', '2026-M10', {
      status: 'published', valuesJson: JSON.stringify({ actual: '3.7' }),
      firstPublishedActual: '3.7'
    }))
    // 一条只有自己的孤儿：改名，不删行。
    upsertCalendarStandardRow(database, row('US.CORE_CPI.NSA.YOY', '2026-M09'))
    database.prepare(`insert into mi_calendar_event_source_ids
      (provider_id, source_event_id, country_code, metric_key, period_key, first_scheduled_date, observed_at)
      values ('macro-calendar-official-replay', 'US.CPI.NSA.YOY.RELEASE.2026-M10', 'USA', 'US.CPI.NSA.YOY', '2026-M10', '2026-11-10', ?)`)
      .run(now)

    const report = mergeMPeriodStandardRows(database)
    expect(report).toEqual({ renamed: 1, merged: 1, ledgerRewritten: 1, ledgerDropped: 0 })
    const rows = database.prepare('select metric_key, period_key, status, values_json, first_published_actual from mi_calendar_events order by metric_key, period_key')
      .all() as { metric_key: string; period_key: string; status: string; values_json: string; first_published_actual: string | null }[]
    // 只剩归一后的两行：没有 `2026-M10`，也没有 `2026-M09`。
    expect(rows.map((entry) => `${entry.metric_key}@${entry.period_key}`)).toEqual([
      'US.CORE_CPI.NSA.YOY@2026-09', 'US.CPI.NSA.YOY@2026-10'
    ])
    const cpi = rows[1]!
    // 有值的那行赢了：状态、值、首发布值都从它来；共识留在同一行里。
    expect(cpi.status).toBe('published')
    expect(JSON.parse(cpi.values_json)).toEqual({ consensus: '3.5', actual: '3.7' })
    expect(cpi.first_published_actual).toBe('3.7')
    // 台账改到留下的那行上，期次与 id 都已归一。
    const ledger = database.prepare('select period_key, source_event_id from mi_calendar_event_source_ids').all() as
      { period_key: string; source_event_id: string }[]
    expect(ledger).toEqual([{ period_key: '2026-10', source_event_id: 'US.CPI.NSA.YOY.RELEASE.2026-10' }])
    // 备份留着整表快照。
    expect((database.prepare(`select count(*) c from ${calendarPeriodKeyMergePolicy.backupTable}`).get() as { c: number }).c).toBe(3)
    expect(mergeMPeriodStandardRows(database)).toEqual({ renamed: 0, merged: 0, ledgerRewritten: 0, ledgerDropped: 0 })
  })

  it('两边都没有值时也不丢行：合成一行、状态按留下的那行', () => {
    const database = setup()
    upsertCalendarStandardRow(database, row('US.NONFARM.SA.CHANGE', '2026-10', { status: 'scheduled' }))
    upsertCalendarStandardRow(database, row('US.NONFARM.SA.CHANGE', '2026-M10', { status: 'missing' }))
    expect(mergeMPeriodStandardRows(database)).toEqual({ renamed: 0, merged: 1, ledgerRewritten: 0, ledgerDropped: 0 })
    const rows = database.prepare('select period_key, status from mi_calendar_events').all() as { period_key: string; status: string }[]
    expect(rows).toEqual([{ period_key: '2026-10', status: 'scheduled' }])
  })
})
