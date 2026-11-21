import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { fillStandardSeriesIds } from './marketCalendarStandardSeriesIdFill'
import { ensureCalendarStandardTables, upsertCalendarStandardRow } from './marketCalendarStandardTable'

/**
 * **源内身份的稳定指标 id 要落进标准表**（`series_id`，0.4.5 #14）。
 *
 * 为什么不能按身份第一段登记名字：真库里 1943 行数组身份对应 1544 个第一段，同一个指标每期
 * 换一个第一段；稳定的是源自己的 `indicator_id`（观测表），德国那 27 条登记就是 `9553` 这种。
 * 所以这一步把观测表的 id 补进标准表，且**只补空值、只认源给的事实**。
 */
const now = '2026-11-21T03:00:00.000Z'

function setup(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  database.exec(`create table mi_macro_calendar_market_event_observations (
    observation_id text primary key, provider_id text not null, source_event_id text not null,
    indicator_id text, display_name text, last_seen_at text not null)`)
  return database
}

function seedStandard(database: DatabaseSync, input: Readonly<{ metricKey: string; sourceEventId: string; seriesId?: string }>): void {
  upsertCalendarStandardRow(database, {
    countryCode: 'DE', metricKey: input.metricKey, periodKey: '2026-07', scheduledDate: '2026-08-06',
    timePrecision: 'date', status: 'published', valuesJson: JSON.stringify({ actual: '1.2%' }),
    sourceProviderId: '0xrouter', sourceEventId: input.sourceEventId, parserVersion: 'v1',
    observedAt: now, firstSeenAt: now, ...(input.seriesId === undefined ? {} : { seriesId: input.seriesId })
  })
}

function seedObservation(database: DatabaseSync, input: Readonly<{ id: string; sourceEventId: string; indicatorId: string | null; lastSeenAt: string }>): void {
  database.prepare(`insert into mi_macro_calendar_market_event_observations
    (observation_id, provider_id, source_event_id, indicator_id, display_name, last_seen_at)
    values (?, '0xrouter', ?, ?, '名', ?)`).run(input.id, input.sourceEventId, input.indicatorId, input.lastSeenAt)
}

const seriesIdOf = (database: DatabaseSync, metricKey: string): string | null =>
  (database.prepare('select series_id from mi_calendar_events where metric_key = ?').get(metricKey) as { series_id: string | null }).series_id

describe('源内身份的稳定 id 补进标准表', () => {
  it('从观测表按 source_event_id 补空值；已有值不动；跑第二遍 0 变更', () => {
    const database = setup()
    seedStandard(database, { metricKey: '["212058",70663]', sourceEventId: '["212058",70663]' })
    seedObservation(database, { id: 'o1', sourceEventId: '["212058",70663]', indicatorId: '9021', lastSeenAt: now })
    const first = fillStandardSeriesIds(database)
    expect(first).toEqual({ pending: 1, filled: 1 })
    expect(seriesIdOf(database, '["212058",70663]')).toBe('9021')
    expect(fillStandardSeriesIds(database)).toEqual({ pending: 0, filled: 0 })
  })

  it('已经有 series_id 的行一个字不动（只补空值）', () => {
    const database = setup()
    seedStandard(database, { metricKey: '["1",2]', sourceEventId: '["1",2]', seriesId: '9553' })
    seedObservation(database, { id: 'o1', sourceEventId: '["1",2]', indicatorId: '9021', lastSeenAt: now })
    expect(fillStandardSeriesIds(database)).toEqual({ pending: 0, filled: 0 })
    expect(seriesIdOf(database, '["1",2]')).toBe('9553')
  })

  it('观测表里没有这个发布、或 indicator_id 为空：整条不猜，仍是空', () => {
    const database = setup()
    seedStandard(database, { metricKey: '["2",3]', sourceEventId: '["2",3]' })
    seedStandard(database, { metricKey: '["3",4]', sourceEventId: '["3",4]' })
    seedObservation(database, { id: 'o2', sourceEventId: '["3",4]', indicatorId: null, lastSeenAt: now })
    const report = fillStandardSeriesIds(database)
    expect(report.filled).toBe(0)
    expect(seriesIdOf(database, '["2",3]')).toBeNull()
    expect(seriesIdOf(database, '["3",4]')).toBeNull()
  })

  it('观测表不存在：报 0，不抛（旧库没有那张表）', () => {
    const database = setup()
    database.exec('drop table mi_macro_calendar_market_event_observations')
    seedStandard(database, { metricKey: '["4",5]', sourceEventId: '["4",5]' })
    expect(fillStandardSeriesIds(database)).toEqual({ pending: 0, filled: 0 })
  })
})