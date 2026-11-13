import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { narwhalSourceEventIdForIdentity } from './marketCalendarMetricIdentity'
import { backfillStandardRowsFromObservations } from './marketCalendarStandardBackfill'

/**
 * 回填的判据：**三类发布各走各的身份，但只问一处分流**。
 *
 * 第一版只写指标行：事件型（讲话、库存、抵押贷款申请这些没有 period 的发布）整类静默消失，
 * 79 条历史数据没有落表、也不在 unmapped 里——读者往前翻就是一段空日历。所以这里钉住的是
 * 「三类都进表」和「跑两遍一样」，不是某一类的细节。
 */

/** 观测表只读这 11 列，其余列与回填无关；列名与真表一致，改列名这里要跟着红。 */
function openDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  database.exec(`create table mi_macro_calendar_market_event_observations (
    source_event_id text not null, provider_id text not null, market_fact_key text,
    display_name text not null, country_code text, scheduled_date text not null, scheduled_at text not null,
    consensus_json text, provider_previous_json text, provider_actual_json text,
    importance text not null, measure_keys_json text, last_seen_at text)`)
  return database
}

function observe(database: DatabaseSync, input: Readonly<{
  metricKey: string
  periodKey: string
  displayName: string
  scheduledAt: string
  measures?: string
}>): void {
  database.prepare(`insert into mi_macro_calendar_market_event_observations
    (source_event_id, provider_id, market_fact_key, display_name, country_code, scheduled_date,
     scheduled_at, consensus_json, provider_previous_json, provider_actual_json, importance,
     measure_keys_json, last_seen_at)
    values (?, 'narwhal', ?, ?, 'USA', ?, ?, null, null, ?, 'high', ?, ?)`)
    .run(`event-${input.metricKey}-${input.periodKey}`,
      JSON.stringify(['narwhal', 'macro-calendar-narwhal-economic-data', 'zh',
        JSON.parse(narwhalSourceEventIdForIdentity({ countryCode: 'USA', metricKey: input.metricKey, periodKey: input.periodKey }))]),
      input.displayName, input.scheduledAt.slice(0, 10), input.scheduledAt,
      JSON.stringify({ displayValue: '1' }), input.measures ?? '["x"]', '2026-11-14T00:00:00.000Z')
}

const standardRows = (database: DatabaseSync) =>
  database.prepare('select metric_key, identity_kind, period_key from mi_calendar_events order by metric_key').all() as Record<string, unknown>[]

describe('从观测表回填标准表', () => {
  it('dry-run 一条都不写（库也可能是只读打开的）', () => {
    const database = openDatabase()
    observe(database, { metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-10', displayName: 'cpi yoy', scheduledAt: '2026-10-15T12:30:00.000Z' })
    const report = backfillStandardRowsFromObservations(database, { write: false })
    expect(report.indicator).toBe(1)
    expect(report.written).toBe(0)
    expect(database.prepare("select 1 from sqlite_master where name = 'mi_calendar_events'").get()).toBeUndefined()
  })

  it('指标行、事件码行、源内身份行三类都进表', () => {
    const database = openDatabase()
    observe(database, { metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-10', displayName: 'cpi yoy', scheduledAt: '2026-10-15T12:30:00.000Z' })
    // 事件型：身份第二段是源给的事件类型、第三段是到分钟的时刻，且**没有 measure**。
    observe(database, { metricKey: 'central-bank-activity', periodKey: '2026-10-16T15:00',
      displayName: 'Petroleum inventories', scheduledAt: '2026-10-16T15:00:00.000Z', measures: '[]' })
    // 有期间但没有值、也翻不成事件码：源内身份，照样显示
    observe(database, { metricKey: 'US.UNMAPPED_INDICATOR.NONE.LEVEL', periodKey: '2026-10',
      displayName: 'Something new', scheduledAt: '2026-10-17T15:00:00.000Z', measures: '[]' })
    const report = backfillStandardRowsFromObservations(database)
    expect(report.indicator).toBe(1)
    expect(report.event).toBe(1)
    expect(report.source).toBe(1)
    expect(report.written).toBe(3)
    const rows = standardRows(database)
    expect(rows.map((row) => row.metric_key)).toEqual(['US.CPI.NSA.YOY', 'US.UNMAPPED_INDICATOR.NONE.LEVEL', 'evt.petroleum-inventories'])
    // 事件型身份到分钟：period 用时刻本身，不借用指标期间
    expect(rows.find((row) => row.metric_key === 'evt.petroleum-inventories')?.period_key).toBe('2026-10-16T15:00')
    expect(rows.find((row) => row.metric_key === 'US.UNMAPPED_INDICATOR.NONE.LEVEL')?.identity_kind).toBe('source')
  })

  it('跑两遍完全一致：按身份 upsert，不新增第二行', () => {
    const database = openDatabase()
    observe(database, { metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-10', displayName: 'cpi yoy', scheduledAt: '2026-10-15T12:30:00.000Z' })
    observe(database, { metricKey: 'central-bank-activity', periodKey: '2026-10-16T15:00',
      displayName: 'Petroleum inventories', scheduledAt: '2026-10-16T15:00:00.000Z', measures: '[]' })
    const first = backfillStandardRowsFromObservations(database)
    const afterFirst = standardRows(database)
    const second = backfillStandardRowsFromObservations(database)
    expect({ ...second, written: 0 }).toEqual({ ...first, written: 0 })
    expect(afterFirst).toHaveLength(2)
    expect(standardRows(database)).toEqual(afterFirst)
  })

  it('算不出身份的发布不吞：记 unmapped 并带原因', () => {
    const database = openDatabase()
    database.prepare(`insert into mi_macro_calendar_market_event_observations
      (source_event_id, provider_id, market_fact_key, display_name, country_code, scheduled_date,
       scheduled_at, consensus_json, provider_previous_json, provider_actual_json, importance,
       measure_keys_json, last_seen_at)
      values ('broken', 'narwhal', null, 'broken row', 'USA', '2026-10-15', '2026-10-15T12:30:00.000Z',
        null, null, null, 'high', '[]', '2026-11-14T00:00:00.000Z')`).run()
    const report = backfillStandardRowsFromObservations(database)
    expect(report.unmapped).toEqual({ 'bad-identity': 1 })
    expect(standardRows(database)).toHaveLength(0)
  })
})
