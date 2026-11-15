import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { narwhalSourceEventIdForIdentity, zeroXRouterIndicatorIdentities } from './marketCalendarMetricIdentity'
import { backfillStandardRowsFromObservations } from './marketCalendarStandardBackfill'
import { ensureCalendarStandardTables, upsertCalendarStandardRow } from './marketCalendarStandardTable'

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
    display_name text not null, country_code text, indicator_id text, event_kind text not null,
    scheduled_date text not null, scheduled_at text not null,
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
  actual?: string
  lastSeenAt?: string
}>): void {
  database.prepare(`insert into mi_macro_calendar_market_event_observations
    (source_event_id, provider_id, market_fact_key, display_name, country_code, event_kind, scheduled_date,
     scheduled_at, consensus_json, provider_previous_json, provider_actual_json, importance,
     measure_keys_json, last_seen_at)
    values (?, 'narwhal', ?, ?, 'USA', 'economic-indicator', ?, ?, null, null, ?, 'high', ?, ?)`)
    .run(`event-${input.metricKey}-${input.periodKey}`,
      JSON.stringify(['narwhal', 'macro-calendar-narwhal-economic-data', 'zh',
        JSON.parse(narwhalSourceEventIdForIdentity({ countryCode: 'USA', metricKey: input.metricKey, periodKey: input.periodKey }))]),
      input.displayName, input.scheduledAt.slice(0, 10), input.scheduledAt,
      input.actual === '' ? null
        : input.actual === undefined ? JSON.stringify({ displayValue: '1' }) : JSON.stringify({ displayValue: input.actual }),
      input.measures ?? '["x"]', input.lastSeenAt ?? '2026-11-14T00:00:00.000Z')
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
    // 工作清单也要幂等：`unmapped` 主键带 `detected_at`，重放时不许用新时间戳再记一遍。
    expect(database.prepare('select count(*) as c from mi_calendar_unmapped').get()).toEqual({ c: 0 })
  })

  it('算不出身份的发布不吞：记 unmapped 并带原因', () => {
    const database = openDatabase()
    database.prepare(`insert into mi_macro_calendar_market_event_observations
      (source_event_id, provider_id, market_fact_key, display_name, country_code, event_kind, scheduled_date,
       scheduled_at, consensus_json, provider_previous_json, provider_actual_json, importance,
       measure_keys_json, last_seen_at)
      values ('broken', 'narwhal', null, 'broken row', 'USA', 'economic-indicator', '2026-10-15', '2026-10-15T12:30:00.000Z',
        null, null, null, 'high', '[]', '2026-11-14T00:00:00.000Z')`).run()
    const report = backfillStandardRowsFromObservations(database)
    expect(report.unmapped).toEqual({ 'bad-identity': 1, 'unknown-measure': 0 })
    expect(standardRows(database)).toHaveLength(0)
    // 再跑一次不新增第二条工作清单行（同一发布、同一原因只记一次）
    backfillStandardRowsFromObservations(database)
    expect(database.prepare('select count(*) as c from mi_calendar_unmapped').get()).toEqual({ c: 1 })
  })
})

describe('旧源重放：只补历史，不覆盖新源', () => {
  /** 旧源的身份来自 `indicator_id` 那张表，区间由发布时刻倒推；这里用一条真实映射（CPI 年率）。 */
  const OLD_CPI_INDICATOR = '1001'

  function openOldDatabase(): DatabaseSync {
    const database = new DatabaseSync(':memory:')
    database.exec(`create table mi_macro_calendar_market_event_observations (
      source_event_id text not null, provider_id text not null, market_fact_key text,
      display_name text not null, country_code text, indicator_id text, event_kind text not null,
      scheduled_date text not null, scheduled_at text not null,
      consensus_json text, provider_previous_json text, provider_actual_json text,
      importance text not null, measure_keys_json text, last_seen_at text)`)
    return database
  }

  it('解出身份且带值的旧行 → 指标行，来源记在 `0xrouter` 上（界面显示「未标来源」）', () => {
    const mapped = Object.entries(zeroXRouterIndicatorIdentities)
      .find(([, entry]) => entry.periodRule === 'month' && entry.metricKey.endsWith('.YOY'))!
    const database = openOldDatabase()
    database.prepare(`insert into mi_macro_calendar_market_event_observations
      (source_event_id, provider_id, market_fact_key, display_name, country_code, indicator_id, event_kind,
       scheduled_date, scheduled_at, consensus_json, provider_previous_json, provider_actual_json,
       importance, measure_keys_json, last_seen_at)
      values ('["77",1]', '0xrouter', null, 'CPI yoy', 'USA', ?, 'economic-indicator',
        '2026-10-15', '2026-10-15T12:30:00.000Z', null, null, '3.5', 'high', null, '2026-11-14T00:00:00.000Z')`)
      .run(mapped[0])
    const report = backfillStandardRowsFromObservations(database, { providerId: '0xrouter' })
    expect(report.indicator).toBe(1)
    const row = database.prepare('select metric_key, source_provider_id from mi_calendar_events').get() as Record<string, unknown>
    expect(row.metric_key).toBe(mapped[1].metricKey)
    expect(row.source_provider_id).toBe('0xrouter')
  })

  it('来源同权：别的来源已经写过同一身份，旧源照样写（后到的非空值覆盖）', () => {
    const mapped = Object.entries(zeroXRouterIndicatorIdentities)
      .find(([, entry]) => entry.periodRule === 'month' && entry.metricKey.endsWith('.YOY'))!
    const database = openOldDatabase()
    ensureCalendarStandardTables(database)
    // 新源先写一行同身份（值 9.9），旧源只补历史、不许盖掉它。
    upsertCalendarStandardRow(database, {
      countryCode: 'USA', metricKey: mapped[1].metricKey, periodKey: '2026-09', scheduledDate: '2026-10-15',
      timePrecision: 'date', valuesJson: JSON.stringify({ actual: '9.9' }), sourceProviderId: 'narwhal',
      sourceEventId: 'narwhal-1', parserVersion: 'v1', observedAt: '2026-11-14T00:00:00.000Z',
      firstSeenAt: '2026-11-14T00:00:00.000Z'
    })
    database.prepare(`insert into mi_macro_calendar_market_event_observations
      (source_event_id, provider_id, market_fact_key, display_name, country_code, indicator_id, event_kind,
       scheduled_date, scheduled_at, consensus_json, provider_previous_json, provider_actual_json,
       importance, measure_keys_json, last_seen_at)
      values ('["78",1]', '0xrouter', null, 'CPI yoy', 'USA', ?, 'economic-indicator',
        '2026-10-15', '2026-10-15T12:30:00.000Z', null, null, '3.5', 'high', null, '2026-11-14T00:00:00.000Z')`)
      .run(mapped[0])
    const report = backfillStandardRowsFromObservations(database, { providerId: '0xrouter' })
    // 旧口径是「新源写过的不覆盖」，那是来源优先级；用户定的是同权——谁拿到非空值谁写。
    expect(report.skippedExisting).toBe(0)
    expect(report.written).toBe(1)
    const [row] = database.prepare('select values_json, source_provider_id from mi_calendar_events').all() as
      { values_json: string; source_provider_id: string }[]
    expect(row!.source_provider_id).toBe('0xrouter')
    // 逐字段合并：旧值里剩下的字段不会被抹掉。
    expect(JSON.parse(row!.values_json)).toEqual({ actual: '9.9' })
  })
})

describe('重放用当前映射，不用观测行当年的口径', () => {
  it('已退役的 PCE 未季调码落到季调码上，绝不把旧码写回去', () => {
    const database = openDatabase()
    // 旧口径的观测行：身份里编码的是 NSA 码
    database.prepare(`insert into mi_macro_calendar_market_event_observations
      (source_event_id, provider_id, market_fact_key, display_name, country_code, event_kind, scheduled_date,
       scheduled_at, consensus_json, provider_previous_json, provider_actual_json, importance,
       measure_keys_json, last_seen_at)
      values ('retired-nsa', 'narwhal', ?, 'PCE price index', 'USA', 'economic-indicator', '2026-09-25',
        '2026-09-25T12:30:00.000Z', null, null, '3.5', 'high', '["x"]', '2026-11-14T00:00:00.000Z')`)
      .run(JSON.stringify(['narwhal', 'macro-calendar-narwhal-economic-data', 'zh',
        JSON.parse(narwhalSourceEventIdForIdentity({ countryCode: 'USA', metricKey: 'US.PCE.NSA.YOY', periodKey: '2026-09' }))]))
    const report = backfillStandardRowsFromObservations(database)
    expect(report.indicator).toBe(1)
    expect(report.unmapped).toEqual({ 'bad-identity': 0, 'unknown-measure': 0 })
    const rows = standardRows(database)
    expect(rows.map((row) => row.metric_key)).toEqual(['US.PCE.SA.YOY'])
    // 旧码一格都不许进表
    expect(rows.some((row) => row.metric_key === 'US.PCE.NSA.YOY')).toBe(false)
  })
})

describe('零值与空值的判据（用户口径 2026-11-15）', () => {
  it('无既有值时，已发布行的真实 0 必须落库（新增就业 0K 不能显示成未提供）', () => {
    const database = openDatabase()
    observe(database, { metricKey: 'US.NONFARM.SA.CHANGE', periodKey: '2026-10', displayName: 'nonfarm payrolls',
      scheduledAt: '2026-11-06T13:30:00.000Z', actual: '0' })
    backfillStandardRowsFromObservations(database)
    const row = database.prepare('select values_json, value_state from mi_calendar_events').get() as
      { values_json: string; value_state: string }
    expect(JSON.parse(row.values_json)).toEqual({ actual: '0' })
    expect(row.value_state).toBe('present')
  })

  it('空串当作没有值：不写、也不把已有值清空', () => {
    const database = openDatabase()
    observe(database, { metricKey: 'US.NONFARM.SA.CHANGE', periodKey: '2026-10', displayName: 'nonfarm payrolls',
      scheduledAt: '2026-11-06T13:30:00.000Z', actual: '165' })
    backfillStandardRowsFromObservations(database)
    observe(database, { metricKey: 'US.NONFARM.SA.CHANGE', periodKey: '2026-10', displayName: 'nonfarm payrolls',
      scheduledAt: '2026-11-06T13:30:00.000Z', actual: '', lastSeenAt: '2026-11-15T00:00:00.000Z' })
    backfillStandardRowsFromObservations(database)
    const row = database.prepare('select values_json from mi_calendar_events').get() as { values_json: string }
    expect(JSON.parse(row.values_json)).toEqual({ actual: '165' })
  })
})
